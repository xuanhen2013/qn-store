'use strict';

const path = require('path');
const fs = require('fs');
const urlParse = require('url').parse;
const Promise = require('bluebird');
const moment = require('moment');
const qn = require('qiniu');
const StorageBase = require('ghost-storage-base');
const errors = require('@tryghost/errors');
const security = require('@tryghost/security');
const getHash = require('./util/getHash');

const logPrefix = '[QiNiuStore]';

class QiNiuStore extends StorageBase {
  constructor(options) {
    super(options);
    const { accessKey, secretKey } = options;
    this.options = options;
    const config = new qn.conf.Config();
    config.zone = qn.zone.Zone_z2;
    this.formUploader = new qn.form_up.FormUploader(config);
    this.mac = new qn.auth.digest.Mac(accessKey, secretKey);
    this.bucketManager = new qn.rs.BucketManager(this.mac, config);

    this.getToken = this.getToken.bind(this);
    this.save = this.save.bind(this);
    this.read = this.read.bind(this);
  }

  getToken() {
    const { bucket } = this.options;
    const putPolicy = new qn.rs.PutPolicy({
      scope: bucket
    })
    return putPolicy.uploadToken(this.mac);
  }

  save(file) {
    return new Promise((resolve, reject) => {
      this.getFileKey(file).then(key => {
        const uploadToken = this.getToken();
        const putExtra = new qn.form_up.PutExtra();
        this.formUploader.putStream(uploadToken, key, fs.createReadStream(file.path), putExtra, (respErr, respBody, respInfo) => {
          if (respErr) {
            console.log(`${logPrefix} save: `, respErr);
            reject(respErr);
            // throw respErr;
          }
          if (respInfo.statusCode === 200) {
            resolve(`${this.options.origin}/${respBody.key}`);
          } else {
            const error = new Error(`${logPrefix} save: save Error, status = ${respInfo.statusCode}`);
            reject(error);
          }
        });
      });
    });
  }

  /**
   * don't need it in Qiniu
   * @param filename
   * @param targetDir
   * @returns {*|bluebird}
   * @see https://support.qiniu.com/hc/kb/article/112817/
   * TODO: if fileKey option set, should use key to check file whether exists
   */
  exists(filename, targetDir) {
    return new Promise(function(resolve, reject) {
      resolve(false);
    });
  }

  serve() {
    // a no-op, these are absolute URLs
    return function customServe(req, res, next) {
      next();
    };
  }

  delete() {
    // return Promise.reject('not implemented');
    return new Promise(function(resolve, reject) {
      resolve(true);
    });
  }

  read(options) {
    options = options || {};
    const key = urlParse(options.path).pathname.slice(1);

    return new Promise(function(resolve, reject) {
      const url = this.bucketManager.publicDownloadUrl(this.options.origin, key);
      if (url) {
        resolve(url);
      }
      reject(new errors.GhostError({
        message: `${logPrefix} Could not read image: ${options.path}`,
      }));
    });
  }

  getFileKey(file) {
    const keyOptions = this.options.fileKey;
    let fileKey = null;

    if (keyOptions) {
      const getValue = function(obj) {
        return typeof obj === 'function' ? obj() : obj;
      };
      const ext = path.extname(file.name);
      let basename = path.basename(file.name, ext);
      let prefix = '';
      let suffix = '';
      let extname = '';

      if (keyOptions.prefix) {
        prefix = moment().format(getValue(keyOptions.prefix))
                          .replace(/^\//, '');
      }

      if (keyOptions.suffix) {
        suffix = getValue(keyOptions.suffix);
      }

      if (keyOptions.extname !== false) {
        extname = ext.toLowerCase();
      }

      const contactKey = function(name) {
        return prefix + name + suffix + extname;
      };

      if (keyOptions.hashAsBasename) {
        return getHash(file).then(function(hash) {
          return contactKey(hash);
        });
      } else if (keyOptions.safeString) {
        basename = security.string.safe(basename);
      }

      fileKey = contactKey(basename);
    }

    return Promise.resolve(fileKey);
  }
}

module.exports = QiNiuStore;
