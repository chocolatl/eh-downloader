const fs = require('fs');
const path = require('path');
const http = require('http');
const {URL} = require('url');

const download = require('download');
const jsdom = require("jsdom");
const {JSDOM} = jsdom;


// TODO JSDOM.fromURL有些情况下会一直处于pending状态不返回resolve/reject，导致永久挂起
// 准备考虑不使用JSDOM.fromURL，使用其它方法获取HTML文本，再使用JSDOM解析


function getImagePageInfo(imagePageURL) {

    let options = {};
    
    return JSDOM.fromURL(imagePageURL, options).then(({window: {document}}) => {
        let imageEl  = document.getElementById('img');
        let imageURL = imageEl.src;
        let nextURL  = imageEl.parentElement.href;

        let onfailReloadCode = /onclick=\"return nl\('(.*)'\)\"/.exec(document.getElementById('loadfail').outerHTML)[1];
        let reloadURL        = imagePageURL + (imagePageURL.indexOf('?') > -1 ? '&' : '?') + 'nl=' + onfailReloadCode;

        return {
            imageURL, nextURL, reloadURL
        };

    });
}

function downloadOne(currentURL, dir, fileName) {

    return getImagePageInfo(currentURL).then(({imageURL, nextURL, reloadURL}) => {
        
        return download(imageURL, dir, {retries: 0, filename: fileName}).catch(err => {
            
            
            // 每次重试URL长度会增加，当长度到128以上停止重试，抛出错误
            if(currentURL.length < 128) {
                
                console.log(err);

                // 模拟点击"Click here if the image fails loading"链接，重新尝试下载当前图片
                return downloadOne(reloadURL, dir, fileName);

            } else {
                throw new Error(`${fileName} Download Failed.`);
            }

        }).then(_ => {
            return nextURL;
        }); 
    });
}

function downloadAll(currentURL, dir, _count = 0) {

    let fileName = _count + '.jpg';
    
    return downloadOne(currentURL, dir, fileName).then(nextURL => {

        console.log(`${fileName} Downloaded Successfully.`);

        if(new URL(nextURL).pathname !== new URL(currentURL).pathname) {
            return downloadAll(nextURL, dir, ++_count);
        } else {
            return Promise.resolve();
        }

    });
}


function downloadDoujinshi(url, dir) {

    try {
        if(fs.existsSync(dir) === false) {
            fs.mkdirSync(dir);
        }
    } catch (err) {
        return Promise.reject(err);
    }

    let options = {};

    return JSDOM.fromURL(url, options).then(({window: {document}}) => {
        
        let firstURL = document.querySelector('#gdt .gdtm:first-of-type a').href;

        return downloadAll(firstURL, dir);
    });
}

module.exports = {
    downloadDoujinshi
}