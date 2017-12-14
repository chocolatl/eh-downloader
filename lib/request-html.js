const request = require('request');
const deepAssign = require('deep-assign');
const cloneDeep = require('clone-deep');

const ACCEPT_HTML  = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8';
const ACCEPT_LANG  = 'en-US,en;q=0.9';
const USER_AGENT   = 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/62.0.3202.75 Safari/537.36';

function requestHTML(url, userOptions = {}) {
    
    userOptions = cloneDeep(userOptions);

    let retries;
    if(userOptions.retries !== undefined) {
        retries = userOptions.retries;
        delete userOptions.retries;
    } else {
        retries = 0;
    }

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

            if(response.statusCode !== 200) {
                return reject(new Error(`Response Error. HTTP Status Code: ${response.statusCode}.`));
            }

            return resolve(body);
        });

    });

    return promise.catch(err => {

        if(err.code === 'ECONNRESET' || err.code === 'ESOCKETTIMEDOUT' || err.code === 'ETIMEDOUT') {

            if(retries > 0) {
                
                options.retries = retries - 1;

                // 等待1000ms后重试
                return new Promise(resolve => setTimeout(resolve, 1000)).then(function() {
                    return requestHTML(url, options);
                });

            } else {
                throw err;
            }
        }
    });
}

module.exports = requestHTML;