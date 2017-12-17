const request = require('request');
const deepAssign = require('deep-assign');
const cloneDeep = require('clone-deep');

const USER_AGENT   = 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/62.0.3202.75 Safari/537.36';

function requestResponse(url, userOptions = {}) {

    userOptions = deepAssign({
        headers: {
            'User-Agent': USER_AGENT
        },
        followRedirect: false
    }, cloneDeep(userOptions));

    return new Promise(function(resolve, reject) {
        request.get(url, userOptions).on('response', response => {
            return resolve(response);
        }).on('error', reject);
    });
}

module.exports = requestResponse;