import io

zh_old = '''- **复习入口**：命令面板或文档标题菜单'''
zh_new = '''- **提前复习**：按知识点复习时，若该知识点当前没有到期题目，会按掌握度从低到高补题，适合「今天就想练某个薄弱点」；到期题目存在时仍只给到期题目
- **复习入口**：命令面板或文档标题菜单'''

en_old = '''- **Entry point**: command palette or document title menu'''
en_new = '''- **Reviewing ahead of schedule**: when a knowledge-point review has nothing due, the weakest questions on that topic are served first — handy when you want to drill a weak area today. When due questions exist, only those are served
- **Entry point**: command palette or document title menu'''

for path, a, b in (('README.zh-CN.md', zh_old, zh_new), ('README.md', en_old, en_new)):
    s = io.open(path, encoding='utf-8').read()
    assert s.count(a) == 1, (path, s.count(a))
    io.open(path, 'w', encoding='utf-8', newline='\n').write(s.replace(a, b, 1))
    print('patched', path)

# 统计页薄弱环节的复习入口
zh_old = '''  - **统计**：时间范围可切换（近 7/30/90 天或全部）'''
zh_new = '''  - **统计**：薄弱环节排行的知识点可直接点「复习」开始一次该知识点的复习；时间范围可切换（近 7/30/90 天或全部）'''
en_old = '''  - **Statistics**: switch the range (last 7/30/90 days or all time)'''
en_new = '''  - **Statistics**: in the weakest-areas ranking, each knowledge point has a "Review" action that starts a session on that topic; switch the range (last 7/30/90 days or all time)'''
for path, a, b in (('README.zh-CN.md', zh_old, zh_new), ('README.md', en_old, en_new)):
    s = io.open(path, encoding='utf-8').read()
    assert s.count(a) == 1, (path, s.count(a))
    io.open(path, 'w', encoding='utf-8', newline='\n').write(s.replace(a, b, 1))
    print('patched stats', path)

p = 'CHANGELOG.md'
s = io.open(p, encoding='utf-8').read()
anchor = '- 题库按知识点筛选，并可从筛选结果直接开始一次只含该知识点到期题目的复习会话'
i = s.index(anchor)
s = s[:i] + '''- 统计页薄弱环节的知识点排行可直接开始该知识点的复习；按知识点复习时若无到期题目，改按掌握度从低到高提前复习，到期题目存在时仍只给到期题目
''' + s[i:]
s = s.replace('新增 722 个单元测试（30 个文件）', '新增 726 个单元测试（30 个文件）', 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('changelog patched')

p = 'README.zh-CN.md'
s = io.open(p, encoding='utf-8').read()
n = s.replace('*.test.ts（30 个文件 / 722 个用例）', '*.test.ts（30 个文件 / 726 个用例）', 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(n)
print('count patched', n != s)
