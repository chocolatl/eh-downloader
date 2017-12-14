const fs = require('fs');

const request = require('request');
const deepAssign = require('deep-assign');

const USER_AGENT   = 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/62.0.3202.75 Safari/537.36';

function downloadFile(url, path, userOptions = {}) {
    
    return new Promise(function(resolve, reject) {

        let stream = fs.createWriteStream(path);
        let donwloadTimeout = 100000;
        let timerId;

        let options = {
            timeout: 60000,
            headers: {
                'User-Agent': USER_AGENT
            }
        }

        options = deepAssign(options, userOptions);

        // 此处的timeout为等待服务器响应的时间
        request.get(url, options).on('error', function(err) {
            return reject(err);
        }).on('response', function(response) {

            if(response.statusCode !== 200) {
                return reject(new Error(`Response Error. HTTP Status Code: ${response.statusCode}.`));
            }

            // 到达等待时间下载未完成，销毁可写流并发出错误事件
            timerId = setTimeout(function() {
                stream.destroy(new Error('Download Timeout.'));
            }, donwloadTimeout);

        }).pipe(stream);
    
        stream.on('error', function(err) {

            // 出错时清除时钟
            clearTimeout(timerId);

            return reject(err);
        });
    
        stream.on('finish', function() {

            // 下载完成清除时钟
            clearTimeout(timerId);

            return resolve();
        });
    });
}

module.exports = downloadFile;