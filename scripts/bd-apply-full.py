# -*- coding: utf-8 -*-
# 字节校招申请表一键填充+提交管线（2026-09-21 实测路径固化，2026-09-22 参数化）
# 步骤：基础信息 -> 城市 -> 简历上传+解析 -> 学历类型/学院 -> 渠道问卷 -> 隐私勾选 -> 提交 -> 确认(继续投递)
#
# 个人信息来源（优先级）：命令行参数 > 环境变量(YJTD_IDNUM) > state.json 的 resume.basic
# 身份证号不落盘：仅从 --idnum 参数或 YJTD_IDNUM 环境变量读取
# 用法示例：
#   python scripts/bd-apply-full.py --idnum 32050620050320001X --cities 上海,杭州 --detail-id 7667879966262528261
import json, subprocess, os, time, re, base64, sys, argparse

def _load_state():
    path = os.path.join(os.environ.get('APPDATA', ''), 'yijian-toudi', 'state.json')
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}

def _find_pdf(state):
    # 1) userData/resumes/<resumeFile>  2) 简历目录兜底
    basic = (state.get('resume') or {}).get('basic') or {}
    name = basic.get('name') or 'resume'
    cands = []
    ud = os.path.join(os.environ.get('APPDATA', ''), 'yijian-toudi', 'resumes')
    rf = basic.get('resumeFile')
    if rf:
        cands.append(os.path.join(ud, rf))
    for d in (ud, r'E:\共享\工作\简历\软件开发'):
        if os.path.isdir(d):
            for fn in sorted(os.listdir(d), reverse=True):
                if fn.lower().endswith('.pdf') and name in fn:
                    cands.append(os.path.join(d, fn))
    for c in cands:
        if os.path.isfile(c):
            return c
    return None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--detail-id', default='7667879966262528261', help='字节岗位详情数字ID（列表页 a[href] 里的真实链接，非显示码）')
    ap.add_argument('--name'); ap.add_argument('--phone'); ap.add_argument('--email')
    ap.add_argument('--idnum', default=os.environ.get('YJTD_IDNUM', ''), help='身份证号（也可用环境变量 YJTD_IDNUM）')
    ap.add_argument('--pdf', help='简历PDF路径（默认自动从 app resumes 目录/简历目录找）')
    ap.add_argument('--cities', default='上海,杭州', help='意向城市，逗号分隔，最多3个')
    ap.add_argument('--college', default='人工智能与计算机学院')
    ap.add_argument('--port', default='9222', help='一键投递 app 的 CDP 调试端口')
    ap.add_argument('--dry-run', action='store_true', help='只填表不点最终提交/确认')
    args = ap.parse_args()

    state = _load_state()
    basic = (state.get('resume') or {}).get('basic') or {}
    NAME = args.name or basic.get('name') or ''
    PHONE = args.phone or basic.get('phone') or ''
    EMAIL = args.email or basic.get('email') or ''
    IDNUM = args.idnum
    PDF = args.pdf or _find_pdf(state)
    if not (NAME and PHONE and EMAIL):
        sys.exit('缺少姓名/手机/邮箱：app 简历没填且未传参数')
    if not IDNUM:
        sys.exit('缺少身份证号：传 --idnum 或设环境变量 YJTD_IDNUM')
    if not PDF:
        sys.exit('找不到简历PDF：传 --pdf 指定路径')
    print('profile: %s %s %s pdf=%s' % (NAME, PHONE[:3] + '****' + PHONE[-4:], EMAIL, PDF))

    global PROJ, CITIES, DETAIL_ID, PORT
    PROJ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    CITIES = [c.strip() for c in args.cities.split(',') if c.strip()][:3]
    DETAIL_ID = args.detail_id
    PORT = args.port

    run_pipeline(NAME, PHONE, EMAIL, IDNUM, PDF, args.college, args.dry_run)

PROJ = r'E:\共享\创业\一键投递'
TMP = os.environ.get('TEMP', r'C:\Temp')
CITIES = ['上海', '杭州']
DETAIL_ID = '7667879966262528261'
PORT = '9222'

def bridge(tool, args, timeout=45000):
    expr = "window.oneClick.debugKimi({ tool: %s, args: %s, timeoutMs: %d })" % (json.dumps(tool), json.dumps(args), timeout)
    out = subprocess.run(['node', 'scripts/cdp-app.cjs', expr, PORT], capture_output=True, text=True, cwd=PROJ)
    return (out.stdout + out.stderr).strip()

def ev(code, timeout=90000):
    fp = os.path.join(TMP, 'bd_expr.js')
    with open(fp, 'w', encoding='utf-8') as f:
        f.write(code)
    expr = "window.oneClick.debugKimi({ tool: 'evaluate', args: { code: %s }, timeoutMs: %d })" % (json.dumps(open(fp, encoding='utf-8').read()), timeout)
    fp2 = os.path.join(TMP, 'bd_call.js')
    with open(fp2, 'w', encoding='utf-8') as f:
        f.write(expr)
    out = subprocess.run(['node', 'scripts/cdp-app-file.cjs', fp2, PORT], capture_output=True, text=True, cwd=PROJ)
    return (out.stdout + out.stderr).strip()

def center(js):
    r = ev(js)
    m = re.search(r'"value":"(-?\d+),(-?\d+)', r)
    return (int(m.group(1)), int(m.group(2))) if m else None

def click(js, settle=1.2):
    c = center(js)
    if not c:
        return False
    x, y = c
    bridge('cdp', {'method': 'Input.dispatchMouseEvent', 'params': {'type': 'mouseMoved', 'x': x, 'y': y}})
    bridge('cdp', {'method': 'Input.dispatchMouseEvent', 'params': {'type': 'mousePressed', 'x': x, 'y': x and y, 'button': 'left', 'clickCount': 1}})
    time.sleep(0.12)
    bridge('cdp', {'method': 'Input.dispatchMouseEvent', 'params': {'type': 'mouseReleased', 'x': x, 'y': y, 'button': 'left', 'clickCount': 1}})
    time.sleep(settle)
    return True

def click_at(x, y, settle=1.2):
    bridge('cdp', {'method': 'Input.dispatchMouseEvent', 'params': {'type': 'mouseMoved', 'x': x, 'y': y}})
    bridge('cdp', {'method': 'Input.dispatchMouseEvent', 'params': {'type': 'mousePressed', 'x': x, 'y': y, 'button': 'left', 'clickCount': 1}})
    time.sleep(0.12)
    bridge('cdp', {'method': 'Input.dispatchMouseEvent', 'params': {'type': 'mouseReleased', 'x': x, 'y': y, 'button': 'left', 'clickCount': 1}})
    time.sleep(settle)

def fill_input(idx, text):
    ev("(function(){ var ins = Array.from(document.querySelectorAll('input')).filter(function(i){ return i.offsetParent !== null; }); if (ins[%d]) { ins[%d].scrollIntoView({ block: 'center' }); } return 'ok'; })()" % (idx, idx))
    time.sleep(0.6)
    c = center("(function(){ var ins = Array.from(document.querySelectorAll('input')).filter(function(i){ return i.offsetParent !== null; }); var r = ins[%d].getBoundingClientRect(); return Math.round(r.x + r.width / 2) + ',' + Math.round(r.y + r.height / 2); })()" % idx)
    if not c:
        return False
    click_at(c[0], c[1], 0.5)
    bridge('cdp', {'method': 'Input.insertText', 'params': {'text': text}})
    time.sleep(0.5)
    return True

def find_by_text(text):
    js = "(function(){ var els = Array.from(document.querySelectorAll('li, div, span, button')).filter(function(e){ return e.offsetParent !== null && e.children.length === 0 && e.textContent.trim() === '%s'; }); if (!els.length) { return 'NF'; } var el = els[els.length - 1]; el.scrollIntoView({ block: 'center' }); var r = el.getBoundingClientRect(); return Math.round(r.x + r.width / 2) + ',' + Math.round(r.y + r.height / 2); })()" % text
    return center(js)

def step(msg):
    print('[%s] %s' % (time.strftime('%H:%M:%S'), msg), flush=True)

# ============ 主流程 ============
def run_pipeline(NAME, PHONE, EMAIL, IDNUM, PDF, COLLEGE, DRY_RUN=False):
    step('导航到申请页 (岗位 %s)' % DETAIL_ID)
    bridge('navigate', {'url': 'https://jobs.bytedance.com/campus/resume/%s/apply' % DETAIL_ID})
    time.sleep(8)

    step('焦点仿真')
    bridge('cdp', {'method': 'Emulation.setFocusEmulationEnabled', 'params': {'enabled': True}})
    bridge('cdp', {'method': 'Page.setWebLifecycleState', 'params': {'state': 'active'}})
    time.sleep(2)

    step('1/9 基础信息')
    fill_input(2, NAME)
    fill_input(4, PHONE)
    fill_input(5, EMAIL)
    fill_input(7, IDNUM)
    print(ev("(function(){ var ins = Array.from(document.querySelectorAll('input')).filter(function(i){ return i.offsetParent !== null; }); return JSON.stringify([ins[2] && ins[2].value, ins[4] && ins[4].value, ins[5] && ins[5].value, ins[7] && ins[7].value]); })()")[:200])

    step('2/9 城市')
    click("(function(){ var ins = Array.from(document.querySelectorAll('input')).filter(function(i){ return i.offsetParent !== null; }); var t = ins[1]; t.scrollIntoView({ block: 'center' }); var r = t.getBoundingClientRect(); return Math.round(r.x + r.width / 2) + ',' + Math.round(r.y + r.height / 2); })()")
    for city in CITIES:
        c = find_by_text(city)
        if c:
            click_at(c[0], c[1], 0.8)
            step('  城市 %s 已选 @%d,%d' % (city, c[0], c[1]))

    step('3/9 简历上传')
    with open(PDF, 'rb') as f:
        b64 = base64.b64encode(f.read()).decode()
    chunks = [b64[i:i+130000] for i in range(0, len(b64), 130000)]
    for i, c in enumerate(chunks):
        ev("window.__b64parts = window.__b64parts || []; window.__b64parts.push('%s'); 'P' + window.__b64parts.length" % c)
    step('  base64 %d 块已推' % len(chunks))
    up = ev("(function(){ var span = document.querySelector('span[class*=ant-upload], span[class*=upload]'); if (!span) { return 'NO_SPAN'; } var fk = Object.keys(span).filter(function(k){ return k.indexOf('__reactInternalInstance') === 0 || k.indexOf('__reactFiber') === 0; })[0]; var inst = span[fk].return.stateNode; var b64 = window.__b64parts.join(''); var bin = atob(b64); var bytes = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) { bytes[i] = bin.charCodeAt(i); } var file = new File([bytes], 'resume.pdf', { type: 'application/pdf' }); inst.uploadFiles([file]); return 'UPLOADED'; })()")
    step('  ' + up[:80])
    time.sleep(12)

    step('4/9 解析并覆盖')
    c = find_by_text('解析并覆盖')
    if c:
        click_at(c[0], c[1], 2)
        step('  解析已触发')
    time.sleep(14)

    step('5/9 重填身份证(解析覆盖后)')
    fill_input(7, IDNUM)
    print(ev("(function(){ var ins = Array.from(document.querySelectorAll('input')).filter(function(i){ return i.offsetParent !== null; }); return 'id=[' + (ins[7] && ins[7].value) + '] school=[' + (ins[12] && ins[12].value) + ']'; })()")[:150])

    step('6/9 学历类型+学院')
    click("(function(){ var ins = Array.from(document.querySelectorAll('input')).filter(function(i){ return i.offsetParent !== null; }); var t = ins[11]; if (!t) { return 'GONE'; } t.scrollIntoView({ block: 'center' }); var r = t.getBoundingClientRect(); return Math.round(r.x + r.width / 2) + ',' + Math.round(r.y + r.height / 2); })()")
    c = find_by_text('统招全日制')
    if c:
        click_at(c[0], c[1], 0.8)
        step('  学历类型=统招全日制')
    fill_input(14, COLLEGE)

    step('7/9 渠道问卷')
    click("(function(){ var labels = Array.from(document.querySelectorAll('div, label, span')).filter(function(e){ return e.offsetParent !== null && e.children.length === 0 && e.textContent.trim().indexOf('你从哪里获知') === 0; }); if (!labels.length) { return 'NF'; } var lbl = labels[0]; lbl.scrollIntoView({ block: 'center' }); var item = lbl.closest('.ud-formily-item'); var sel = item ? item.querySelector('[class*=select]') : null; if (!sel) { return 'NO_SEL'; } var r = sel.getBoundingClientRect(); return Math.round(r.x + r.width / 2) + ',' + Math.round(r.y + r.height / 2); })()")
    c = find_by_text('字节跳动招聘官方渠道/账号')
    if c:
        click_at(c[0], c[1], 1.5)
        step('  主渠道已选')
    c = find_by_text('校园招聘官网')
    if c:
        click_at(c[0], c[1], 1)
        step('  子渠道=校园招聘官网')

    step('8/9 隐私勾选')
    click("(function(){ var cbs = Array.from(document.querySelectorAll('input[type=checkbox]')).filter(function(c){ return c.offsetParent !== null; }); var target = null; cbs.forEach(function(c){ var wrap = c.closest('label, [class*=checkbox], span') || c.parentElement; if (wrap && wrap.textContent.indexOf('我已阅读并同意') >= 0) { target = wrap; } }); if (!target && cbs.length) { target = cbs[cbs.length - 1]; } if (!target) { return 'NF'; } target.scrollIntoView({ block: 'center' }); var r = target.getBoundingClientRect(); return Math.round(r.x + r.width / 2) + ',' + Math.round(r.y + r.height / 2); })()")
    print(ev("(function(){ var cbs = Array.from(document.querySelectorAll('input[type=checkbox]')).filter(function(c){ return c.offsetParent !== null; }); return 'checked=' + cbs.map(function(c){ return c.checked; }).join(','); })()")[:100])

    if DRY_RUN:
        step('--dry-run：跳过提交，表单已填好留在页面上')
        print('DONE(dry-run)')
        return

    step('9/9 提交')
    c = center("(function(){ var btns = Array.from(document.querySelectorAll('button')).filter(function(b){ return b.offsetParent !== null && b.textContent.trim() === '提交简历'; }); if (!btns.length) { return 'NF'; } var b = btns[btns.length - 1]; b.scrollIntoView({ block: 'center' }); var r = b.getBoundingClientRect(); return Math.round(r.x + r.width / 2) + ',' + Math.round(r.y + r.height / 2); })()")
    if c:
        click_at(c[0], c[1], 3)
        step('  提交已点')
    time.sleep(4)

    # 确认弹窗：主按钮 = 继续投递
    r = ev("(function(){ var title = Array.from(document.querySelectorAll('.ud__confirm__titleContent, [class*=titleContent]')).filter(function(m){ return m.offsetParent !== null && m.textContent.indexOf('确定投递吗') >= 0; })[0]; if (!title) { return 'NO_DIALOG'; } var root = title.closest('.ud__confirm, [class*=confirmDialog]') || title.parentElement.parentElement.parentElement; var btns = Array.from(root.querySelectorAll('button')).filter(function(b){ return b.offsetParent !== null; }); return btns.map(function(b){ var r = b.getBoundingClientRect(); return b.textContent.trim().slice(0, 10) + '@' + Math.round(r.x + r.width / 2) + ',' + Math.round(r.y + r.height / 2); }).join(' | '); })()")
    step('确认框按钮: ' + r[:200])
    m = re.search(r'继续投递@(-?\d+),(-?\d+)', r)
    if m:
        x, y = int(m.group(1)), int(m.group(2))
        click_at(x, y, 3)
        step('  已点[继续投递] 确认投递!')
    time.sleep(10)

    step('验证应聘记录')
    bridge('navigate', {'url': 'https://jobs.bytedance.com/campus/position/application'})
    time.sleep(7)
    final = ev("(function(){ var lines = (document.body.innerText || '').split(String.fromCharCode(10)).filter(function(s){ return s.trim(); }); var idx = lines.indexOf('应聘记录'); return lines.slice(Math.max(idx, 0), Math.max(idx, 0) + 8).join(' | '); })()")
    step('记录页: ' + final[:300])
    print('DONE')

if __name__ == '__main__':
    main()
