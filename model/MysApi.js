import md5 from 'md5';
import fetch from 'node-fetch';

export default class MysApi {
  constructor(uid, cookie) {
    this.uid = uid;
    this.cookie = cookie;
    this.device = this.getGuid();
  }

  getUrl(type, data = {}) {
    const urlMap = {
      createVerification: {
        url: 'https://bbs-api.miyoushe.com/misc/wapi/createVerification',
        query: 'is_high=false&gids=2'
      },
      verifyVerification: {
        url: 'https://bbs-api.miyoushe.com/misc/wapi/verifyVerfication',
        body: data
      }
    };
    if (!urlMap[type]) return false;

    let { url, query = '', body = '' } = urlMap[type];
    if (query) url += `?${query}`;
    if (body) body = JSON.stringify(body);

    const headers = this.getHeaders(query, body);
    return { url, headers, body };
  }

  async getData(type, data = {}) {
    const { url, headers, body } = this.getUrl(type, data);
    if (!url) return { retcode: -1, message: 'Invalid API type' };

    headers.Cookie = this.cookie;

    const param = {
      headers,
      method: body ? 'POST' : 'GET',
      body: body || undefined,
      timeout: 15000
    };

    try {
      const response = await fetch(url, param);
      if (!response.ok) {
        logger.error(`[荷花插件] MysApi请求失败 ${response.status}: ${url}`);
        return { retcode: response.status, message: response.statusText };
      }
      return await response.json();
    } catch (error) {
      logger.error(`[荷花插件] MysApi请求异常: ${error}`);
      return false; // 返回 false 以匹配日志中的行为
    }
  }

  getHeaders(q = '', b = '') {
    const t = Math.round(Date.now() / 1000);
    const r = Math.floor(Math.random() * 900000 + 100000);
    const n = 'xV8v4Qu54lUKrEYFZkJhB8cuOh9Asafs';
    const ds = md5(`salt=${n}&t=${t}&r=${r}&b=${b}&q=${q}`);
    
    return {
      'DS': `${t},${r},${ds}`,
      'x-rpc-app_version': '2.60.1',
      'x-rpc-client_type': '5',
      'x-rpc-device_id': this.device,
      'User-Agent': `Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36 miHoYoBBS/2.60.1`,
      'Referer': 'https://webstatic.mihoyo.com/',
      'Origin': 'https://webstatic.mihoyo.com',
      'X-Requested-With': 'com.mihoyo.hyperion'
    };
  }
  
  getGuid() {
    function S4() {
      return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
    }
    return (S4() + S4() + '-' + S4() + '-' + S4() + '-' + S4() + '-' + S4() + S4() + S4());
  }
}