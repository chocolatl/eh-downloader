const fs = require('fs');
const path = require('path');
const http = require('http');
const {URL} = require('url');
const EventEmitter = require('events');

const jsdom = require("jsdom");
const {JSDOM} = jsdom;
const request = require('request');
const yaml = require('js-yaml');

const USER_CONFIG  = yaml.load(fs.readFileSync('config.yml', 'utf8'));

const USER_AGENT   = USER_CONFIG['download']['userAgent'];
const ACCEPT_HTML  = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8';
const ACCEPT_IMAGE = 'image/webp,image/apng,image/*,*/*;q=0.8';
const ACCEPT_LANG  = 'en-US,en;q=0.9';


function downloadFile(url, path) {

    return new Promise(function(resolve, reject) {
        let stream          = fs.createWriteStream(path);
        let donwloadTimeout = 100000;
        let timerId;

        // 此处的timeout为等待服务器响应的时间
        request.get(url, {timeout: 60000}).on('error', function(err) {
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

function requestHTML(url, userOptions = {}) {

    return new Promise(function(resolve, reject) {

        let options = {
            timeout: 60000,
            gzip   : true,
            headers: {
                'user-agent': USER_AGENT,
                'accept': ACCEPT_HTML,
                'accept-language': ACCEPT_LANG
            }
        }

        if(userOptions.headers) {
            Object.assign(options.headers, userOptions.headers);
            delete userOptions.headers;
        }

        Object.assign(options, userOptions);

        request.get(url, options, function(err, response, body) {

            if(err) return reject(err);

            if(response.statusCode !== 200) {
                return reject(new Error(`Response Error. HTTP Status Code: ${response.statusCode}.`));
            }

            return resolve(body);
        });

    });
}

function getAllImagePageLink(detailsPageURL) {

    // 防止URL带上页数的参数,以确保是详情页的第一页
    detailsPageURL = detailsPageURL.split('?')[0];

    return requestHTML(detailsPageURL).then(html => {

        let {window: {document}} = new JSDOM(html);

        let pageNavLinks = document.querySelector('.gtb').querySelectorAll('a');

            pageNavLinks = Array.from(pageNavLinks).map(el => el.href);

            pageNavLinks = pageNavLinks.length === 1 ? 
                           pageNavLinks : pageNavLinks.slice(0, -1);     // 去除最后一个链接（下一页箭头的链接）

            pageNavLinks = pageNavLinks.map(link => {
                
                return requestHTML(link).then(html => {

                    let {window: {document}} = new JSDOM(html);

                    let imagePageLinks = document.querySelectorAll('#gdt > .gdtm a');
                        imagePageLinks = Array.from(imagePageLinks).map(el => el.href);

                    return imagePageLinks;
                });
                
            });

        return Promise.all(pageNavLinks).then(results => {

            let imagePages = [];

            results.forEach(arr => imagePages.push(...arr));

            return imagePages;
        });
    });
}

function getImagePageInfo(imagePageURL) {

    return requestHTML(imagePageURL).then(html => {

        let {window: {document}} = new JSDOM(html);
        
        let imageEl  = document.getElementById('img');
        let imageURL = imageEl.src;
        let nextURL  = imageEl.parentElement.href;

        let reloadCode = /onclick=\"return nl\('(.*)'\)\"/.exec(document.getElementById('loadfail').outerHTML)[1];
        let reloadURL  = imagePageURL + (imagePageURL.indexOf('?') > -1 ? '&' : '?') + 'nl=' + reloadCode;

        return {
            imageURL, nextURL, reloadURL
        };

    });
}

async function downloadIamge(imagePageURL, saveDir, fileName) {
    
    let lastErr  = null,
        retries  = USER_CONFIG['download']['retries'] || 0,
        nlretry  = USER_CONFIG['download']['nlretry'] || false;

    let savePath = path.join(saveDir, fileName);

    let {imageURL, reloadURL} = await getImagePageInfo(imagePageURL);

    do {
        try {

            await downloadFile(imageURL, savePath);

        } catch (err) {

            lastErr = err;
            continue;
        }

        // 没有捕捉到错误说明下载成功，跳出循环
        lastErr = null;
        break;

    } while(retries--);


    if(lastErr !== null && nlretry === true) {

        // 模拟点击"Click here if the image fails loading"链接，重新尝试下载当前图片
        let {imageURL, reloadURL} = await getImagePageInfo(imagePageURL);
        await downloadFile(imageURL, savePath);

    } else if(lastErr !== null) {

        throw lastErr;
    }
}


function downloadAll(indexedLinks, saveDir, threads = 3) {

    let evo = new EventEmitter();

    let total = indexedLinks.length;
    let processed = 0;

    for(let i = 0; i < threads; i++) {
        downloadOne();
    }

    function downloadOne() {

        if(indexedLinks.length === 0) return;
        
        let [index, url] = indexedLinks.shift();
        let fileName = index + '.jpg';

        function handle() {

            evo.emit('progress', ++processed, total);

            downloadOne();

            if(processed === total) {
                evo.emit('done');
            }
        }

        downloadIamge(url, saveDir, fileName).then(function() {

            evo.emit('download', {fileName, index, url});
            handle();

        }).catch(function(err) {

            evo.emit('fail', err, {fileName, index, url});
            handle();
        });
    }

    return evo;
}

function downloadDoujinshi(detailsPageURL, saveDir) {

    try {
        if(fs.existsSync(saveDir) === false) {
            fs.mkdirSync(saveDir);
        }
    } catch (err) {
        return Promise.reject(err);
    }

    return getAllImagePageLink(detailsPageURL).then(links => {
        return downloadAll([...links.entries()], saveDir, USER_CONFIG['download']['threads']);
    });

}

module.exports = {
    downloadDoujinshi
}