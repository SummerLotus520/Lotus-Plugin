import sys
import os
import json
import traceback

lotus_plugin_root = os.path.dirname(os.path.dirname(__file__))
geetest_crack_path = os.path.join(lotus_plugin_root, 'geetest-crack')
sys.path.append(geetest_crack_path)

from geetest_crack.geetest_session import GeetestSession
from geetest_crack.utils.response import Resp

def main(gt, challenge):
    """
    接收 gt 和 challenge，调用 geetest-crack 破解，并打印结果。
    """
    try:
        # 实例化破解会话，传入 gt 和 challenge
        session = GeetestSession(gt=gt, challenge=challenge)
        
        # 调用核心的滑动函数
        result, validate = session.slide_captcha()
        
        if result == Resp.SUCCESS and validate:
            # 成功后，将 validate 字典转换为 JSON 字符串并打印
            # 这里的 validate 就是我们需要的 geetest_challenge, geetest_validate, geetest_seccode
            print(json.dumps(validate))
            sys.stdout.flush()
        else:
            # 如果失败，打印错误信息到 stderr
            error_message = f"Geetest crack failed. Result: {result}"
            print(error_message, file=sys.stderr)
            sys.stderr.flush()
            sys.exit(1)
            
    except Exception as e:
        # 捕获所有异常，打印到 stderr
        error_info = traceback.format_exc()
        print(f"Error in run_crack.py: {error_info}", file=sys.stderr)
        sys.stderr.flush()
        sys.exit(1)

if __name__ == '__main__':
    if len(sys.argv) != 3:
        print("Usage: python run_crack.py <gt> <challenge>", file=sys.stderr)
        sys.stderr.flush()
        sys.exit(1)

    gt_param = sys.argv[1]
    challenge_param = sys.argv[2]
    main(gt_param, challenge_param)