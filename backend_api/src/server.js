const app = require('./app');
const os = require('os');

const port = Number(process.env.PORT || 4000);

function localUrls() {
  const urls = [`http://localhost:${port}`];
  Object.values(os.networkInterfaces())
    .flat()
    .filter((item) => item && item.family === 'IPv4' && !item.internal)
    .forEach((item) => urls.push(`http://${item.address}:${port}`));
  return urls;
}

app.listen(port, '0.0.0.0', () => {
  console.log('HTTP server running:');
  localUrls().forEach((url) => console.log(`  ${url}`));
});
