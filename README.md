E站本子下载脚本

## 作为全局命令使用

```
$ npm install -g https://github.com/Chocolatl/ehentai-downloader.git
```

或

```
$ git clone https://github.com/Chocolatl/ehentai-downloader.git
$ npm install -g ehentai-downloader
```

### 完整下载

```
$ eget <url> [path]

  参数
    url  本子详情页面的URL
    path 存放目录路径，不存在会自动创建，默认为当前工作目录

  示例
    $ eget https://e-hentai.org/g/1008611/abcdefghij/
    $ eget https://e-hentai.org/g/1008611/abcdefghij/ D:\
```

### 范围下载

```
$ eget <url> <path> <range>

  参数
    range 下载范围

  示例
    $ eget https://e-hentai.org/g/1008611/abcdefghij/ . 0-2,7,8,9
    $ eget https://e-hentai.org/g/1008611/abcdefghij/ D:\ 120-140
    $ eget https://e-hentai.org/g/1008611/abcdefghij/ D:\ 20-10000
```

注意：`downloadLog`选项优先级更高，如果开启`downloadLog`且下载目录存在`download.json`，范围下载会被忽略

### 配置文件

配置文件[config.yml](https://github.com/Chocolatl/ehentai-downloader/blob/master/config.yml)中包含所有下载配置项，及配置项的详细说明

`eget --config`命令打印配置文件路径，通过以下方式编辑配置文件：

```
Linux
  $ vi $(eget --config)

Windows PowerShell
  $ $config = eget --config
  $ explorer $config
```

## 作为项目依赖使用

```
$ npm install --save https://github.com/Chocolatl/ehentai-downloader.git
```

```js
const CONFIG = {
  download: {
    threads: 5,
    // ...
  }
  login: {
    // ...
  }
}   // 可用的配置项请参照config.yml

const downloadGallery = require('ehentai-downloader')(CONFIG);

downloadGallery('https://e-hentai.org/g/1008611/abcdefghij/', 'D:\\doujinshi').then(ev => {
  
  console.log(ev.dirPath);  // 下载位置
  console.log(ev.dirName);  // 目录名
  console.log(ev.length);   // 总长度

  ev.on('download', info => {
    // 一张图片下载成功
  });

  ev.on('fail', (err, info) => {
    // 一张图片下载失败
  });

  ev.on('done', _ => {
    // 下载结束
  });

  ev.on('error', err => {
    // 下载过程中出现异常
    // 如果发生此事件，本次下载的完整性将无法保证
  });

}).catch(err => {
  // 解析过程中出现异常
});
```

## 已知问题

在下载图片时，如果与下载服务器成功建立连接，但服务器一直不返回主体数据，这时程序会一直等待

request模块貌似并没有提供read timeout的选项，现在临时的解决方案就是重启程序后继续下载

## TODO

- [x] 使用作品名自动创建文件夹
- [x] 账号登录
- [x] 下载原图
- [x] 范围下载
- [x] 保存下载进度记录
- [x] 使用进度记录继续下载
- [x] 通过SOCKS(5)代理下载
- [x] 对exhentai的支持
- [x] 解决图片有时下载不完整的问题
- [x] 使用原文件名保存图片
- [ ] 貌似有点..坏了?..有空需要修一下