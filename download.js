const {downloadGallery} = require('./index.js');

let durl  = process.argv[2];
let dpath = process.argv[3] || '.';

downloadGallery(durl, dpath).then(ev => {
    ev.on('download', info => {
        console.log(`${info.fileName} Download Successful.`);
    });
    
    ev.on('progress', (current, length) => {
        console.log(`Download Progress: ${current} / ${length}.`);
    });
    
    ev.on('done', _ => {
        console.log('done.');
    });
    
    ev.on('fail', (err, info) => {
        console.log(err, info);
    });
    
    ev.on('error', err => {
        console.error(err);
    });
}).catch(err => {
    console.error(err);
});