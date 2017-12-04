const fs = require('fs');
const path = require('path');
const http = require('http');
const {URL} = require('url');
const EventEmitter = require('events');

const jsdom = require("jsdom");
const {JSDOM} = jsdom;
const request = require('request');



const USER_AGENT   = 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/62.0.3202.75 Safari/537.36';
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

        let rq = request.get(url, options, function(err, response, body) {

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

        let pageNavigationLinks = document.querySelector('.gtb').querySelectorAll('a');

            pageNavigationLinks = Array.from(pageNavigationLinks).map(el => el.href);

            pageNavigationLinks = pageNavigationLinks.length === 1 ? 
                                  pageNavigationLinks : 
                                  pageNavigationLinks.slice(0, -1);     // 去除最后一个链接（下一页箭头的链接）

            pageNavigationLinks = pageNavigationLinks.map(link => {
                
                return requestHTML(link).then(html => {

                    let {window: {document}} = new JSDOM(html);

                    let imagePageLinks = document.querySelectorAll('#gdt > .gdtm a');
                        imagePageLinks = Array.from(imagePageLinks).map(el => el.href);

                    return imagePageLinks;
                });
                
            });

        return Promise.all(pageNavigationLinks).then(results => {

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

function downloadIamge(imagePageURL, saveDir, fileName) {
    
    return getImagePageInfo(imagePageURL).then(({imageURL, reloadURL}) => {
        
        return downloadFile(imageURL, path.join(saveDir, fileName)).then(_ => {

            // console.log(`${fileName} Download Successful.`);
            
        }).catch(err => {

            // 还没有点击重试链接
            if(imagePageURL.includes('nl=') === false) {

                // 模拟点击"Click here if the image fails loading"链接，重新尝试下载当前图片
                return downloadIamge(reloadURL, saveDir, fileName);

            } else {
                throw new Error(`${fileName} Download Failed. ${err.message}`);
            }
        });
    });
}

function downloadAll(detailsPageURL, saveDir, threads = 3) {

    let evo = new EventEmitter();

    function autoDownload(links) {

        let indexedLinks = [...links.entries()];
        let processed = 0;

        for(let i = 0; i < threads; i++) {
            downloadOne();
        }

        function downloadOne() {

            if(indexedLinks.length === 0) return;
            
            let [index, url] = indexedLinks.shift();
            let fileName = index + '.jpg';
    
            function handle() {

                evo.emit('progress', ++processed, links.length);

                downloadOne();

                if(processed === links.length) {
                    evo.emit('done');
                }
            }
    
            downloadIamge(url, saveDir, fileName).then(function() {

                evo.emit('download', fileName);
                handle();

            }).catch(function(err) {

                evo.emit('fail', fileName, err);
                handle();
            });
        }
    }
    
    getAllImagePageLink(detailsPageURL).then(autoDownload);

    return evo;
}

function downloadDoujinshi(detailsPageURL, saveDir, threads = undefined) {

    try {
        if(fs.existsSync(saveDir) === false) {
            fs.mkdirSync(saveDir);
        }
    } catch (err) {
        return Promise.reject(err);
    }

    return downloadAll(detailsPageURL, saveDir, threads);
}

module.exports = {
    downloadDoujinshi
}