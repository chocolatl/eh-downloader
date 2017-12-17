const fs = require('fs');

const request = require('request');
const deepAssign = require('deep-assign');
const cloneDeep = require('clone-deep');

const USER_AGENT   = 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/62.0.3202.75 Safari/537.36';

function downloadFile(url, path, userOptions = {}) {

    userOptions = cloneDeep(userOptions);
    
    return new Promise(function(resolve, reject) {

        let stream = fs.createWriteStream(path);

        let options = {
            timeout: 60000,
            headers: {
                'User-Agent': USER_AGENT
            }
        }

        options = deepAssign(options, userOptions);

        request.get(url, options).on('error', function(err) {
            return reject(err);
        }).on('response', function(response) {

            if(response.statusCode !== 200) {
                return reject(new Error(`Response Error. HTTP Status Code: ${response.statusCode}.`));
            }
            
        }).pipe(stream);
    
        stream.on('error', function(err) {
            return reject(err);
        });
    
        stream.on('finish', function() {
            return resolve();
        });
    });
}

module.exports = downloadFile;