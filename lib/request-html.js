const request = require('request');
const deepAssign = require('deep-assign');
const cloneDeep = require('clone-deep');

const ACCEPT_HTML  = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8';
const ACCEPT_LANG  = 'en-US,en;q=0.9';
const USER_AGENT   = 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/62.0.3202.75 Safari/537.36';

function requestHTML(url, userOptions = {}) {
    
    userOptions = cloneDeep(userOptions);

    let options = {
        timeout: 12000,
        gzip   : true,
        headers: {
            'User-Agent': USER_AGENT,
            'Accept': ACCEPT_HTML,
            'Accept-Language': ACCEPT_LANG
        }
    }

    options = deepAssign(options, userOptions);

    let promise = new Promise(function(resolve, reject) {

        request.get(url, options, function(err, response, body) {

            if(err) return reject(err);

            if(response.statusCode >= 400) {
                return reject(new Error(`Response Error. HTTP Status Code: ${response.statusCode}.`));
            }

            return resolve({response, body});
        });

    });

    return promise;
}

module.exports = requestHTML;