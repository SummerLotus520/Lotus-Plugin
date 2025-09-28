import httpx
def game_captcha(gt: str, challenge: str):
    print(f"gt: {gt}, challenge: {challenge}")
    res = httpx.get("http://localhost:9645/pass_uni",params={'gt':gt,'challenge':challenge},timeout=10)
    print(res.text)
    datas = res.json()['data']
    if datas['result'] == 'success':
        return datas['validate']
    return None 
def bbs_captcha(gt: str, challenge: str):
    print(f"gt: {gt}, challenge: {challenge}")
    res = httpx.get("http://localhost:9645/pass_uni",params={'gt':gt,'challenge':challenge},timeout=10)
    print(res.text)
    datas = res.json()['data']
    if datas['result'] == 'success':
        return datas['validate']
    return None