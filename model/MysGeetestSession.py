import sys
import os
import random
import time
import hashlib
import requests
import traceback
import json

from geetest_crack.geetest_session import GSession
from geetest_crack.utils.response import Resp
from geetest_crack.utils.logger import logger

class MysGeetestSession(GSession):
    def __init__(self, uid, cookie):
        super().__init__()
        self.uid = uid
        self.cookie = cookie

    def get_ds_token(self):
        n = "xV8v4Qu54lUKrEYFZkJhB8cuOh9Asafs"
        t = str(int(time.time()))
        r = ''.join(random.sample('abcdefghijklmnopqrstuvwxyz0123456789', 6))
        c = hashlib.md5(f"salt={n}&t={t}&r={r}".encode()).hexdigest()
        return f"{t},{r},{c}"

    def set_gt_challenge(self) -> bool:
        url = "https://bbs-api.miyoushe.com/misc/wapi/createVerification"
        params = {'is_high': 'false', 'gids': '2'}
        headers = {
            'DS': self.get_ds_token(),
            'Cookie': self.cookie,
            'x-rpc-app_version': '2.60.1',
            'x-rpc-client_type': '5',
            'x-rpc-device_id': ''.join(random.choices("abcdefghijklmnopqrstuvwxyz0123456789", k=32)),
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
            'Referer': 'https://webstatic.mihoyo.com/',
        }
        
        try:
            response = requests.get(url, headers=headers, params=params, timeout=10)
            response.raise_for_status()
            res = response.json()
            logger.info(f'[荷花插件] gt/challenge请求结果：{res}')
            
            if res.get("retcode") != 0:
                logger.error(f"[荷花插件] 获取 gt/challenge 失败: {res.get('message')}")
                self.res = Resp.SLIDE_ERR
                return False

            self.gt = res['data']['gt']
            self.challenge = res['data']['challenge']
            return True
        except Exception as e:
            logger.error(f'[荷花插件] 获取gt/challenge网络请求失败: {e}')
            self.res = Resp.TIMEOUT
            return False
            
    def run(self):
        if self.set_gt_challenge() and self.get_php() and self.ajax_php() and self.get_slide_images() and self.get_track() and self.slide():
            logger.info(f'[荷花插件] 获取极验session结果：{self.res}')
            if self.res == Resp.SUCCESS:
                return True, {'geetest_challenge': self.challenge, 'geetest_validate': self.validate, 'geetest_seccode': self.sec_code}
        
        logger.error(f'[荷花插件] 破解流程失败，最终状态: {self.res}')
        return False, None

if __name__ == '__main__':
    if len(sys.argv) != 3:
        print("Usage: python MysGeetestSession.py <uid> <cookie_string>", file=sys.stderr)
        sys.exit(1)

    uid_param = sys.argv[1]
    cookie_param = sys.argv[2]
    
    session_cracker = MysGeetestSession(uid=uid_param, cookie=cookie_param)
    
    try:
        success, validate_data = session_cracker.run()
        if success:
            print(json.dumps(validate_data))
            sys.stdout.flush()
        else:
            print(f"Crack failed with status: {session_cracker.res}", file=sys.stderr)
            sys.exit(1)
    except Exception as e:
        error_info = traceback.format_exc()
        print(f"Error in MysGeetestSession.py execution: {error_info}", file=sys.stderr)
        sys.exit(1)