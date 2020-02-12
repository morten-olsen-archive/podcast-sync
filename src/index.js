const axios = require('axios');
const path = require('path');
const fs = require('fs-extra');
const filenamify = require('filenamify');
const mime = require('mime-types');

const config = require('../config');

const feedLocation = path.join(__dirname, '../../PODCASTS');

const sequence = async (items) => {
  for (let i = 0; i < items.length; i++) {
    await items[i]();
  }
};

const formatDate = (raw) => {
  const date = new Date(raw);
  return `${date.getFullYear()}-${date.getMonth().toString().padStart(2, '0')}-${date.getDay().toString().padStart(2, '0')}`;
};

const getFeed = async (url) => {
  const { data } = await axios.get(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}`);
  return data;
};

const getExtension = (type) => {
  switch(type) {
    case 'audio/mpeg':
      return 'mp3';
    default:
      return mime.extension(type);
  }
};

const downloadItem = async (item, location) => {
  const url = item.enclosure.link;
  const extension = getExtension(item.enclosure.type);
  const date = formatDate(item.pubDate);
  const filename = `${date} ${filenamify(item.title, {replacement: ' '})}.${extension}`;
  const targetLocation = path.join(
    location,
    filename,
  );
  if (fs.existsSync(targetLocation)) {
    console.log(`... skipping existing ${filename}`);
    return;
  }
  console.log(`... downloading ${filename}`);
  const writer = fs.createWriteStream(targetLocation);

  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', () => {
      reject();
      fs.unlinkSync(targetLocation);
    });
  });
};

const updateFeed = async ({ url, maxNew = 5, newerThan }) => {
  const { feed, items } = await getFeed(url);
  console.log(`Updating ${feed.title}`);
  const dataLocation = path.join(feedLocation, path.normalize(feed.title));
  await fs.mkdirp(dataLocation);
  const historyLocation = path.join(
    feedLocation,
    `${filenamify(feed.title, { replacement: ' ' })}.history.json`
  );
  const downloads = fs.existsSync(historyLocation)
    ? await fs.readJSON(historyLocation)
    : [];
  const missingEpisodes = items.filter(i => 
    !downloads.includes(i.guid)
    && (
      !newerThan
      || new Date(item.pubDate).getTime > new Date(newerThan).getTime()
    )
  );
  console.log(`... new episodes ${missingEpisodes.length}`);
  const toDownload = missingEpisodes.slice(0, maxNew);
  console.log(`... episodes to download ${toDownload.length}`);
  await sequence(toDownload.map(item => () => downloadItem(item, dataLocation)));
  await fs.writeJSON(historyLocation, [
    ...downloads,
    ...missingEpisodes.map(m => m.guid),
  ], { spaces: 2 });
};

const run = async () => {
  await fs.mkdirp(feedLocation);
  await sequence(config.feeds.map(f => () => updateFeed(f)));
};

run().catch((err) => {
  console.error(err);
  process.exit(-1);
});
