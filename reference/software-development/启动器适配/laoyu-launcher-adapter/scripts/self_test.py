"""Regression checks for failures that would break preparation or give a false PASS."""
import copy
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from check_adapter import validate, sha256


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / 'icon.png').write_bytes(b'fixture')
        self.package = self.root / 'demo.zip'
        with zipfile.ZipFile(self.package, 'w') as z:
            z.writestr('demo.exe', b'MZfixture-only-not-a-real-application')
        self.data = dict(schemaVersion=1, id='demo', name='演示', version='1.0.0',
                         platform='win32', architecture='x64', executable='demo.exe',
                         category='开发工具', summary='测试', siteUrl='https://lyzbcy.github.io/demo/',
                         iconPath='icon.png', videoIds=[], package=dict(type='portable-zip',
                         path='demo.zip', url='https://lyzbcy.github.io/demo.zip', sha256=sha256(self.package)))

    def tearDown(self):
        self.temp.cleanup()

    def check(self, data=None):
        manifest = self.root / 'launcher-adapter.json'
        manifest.write_text(json.dumps(self.data if data is None else data), encoding='utf-8')
        return validate(manifest, None, False)

    def assert_failure(self, code):
        self.assertTrue(any(r['status'] == 'FAIL' and r['code'] == code for r in self.check()))

    def rewrite_zip(self, entries):
        with zipfile.ZipFile(self.package, 'w') as z:
            for name, content in entries:
                z.writestr(name, content)
        self.data['package']['sha256'] = sha256(self.package)

    def test_valid_fixture_is_not_integration_pass(self):
        rows = self.check()
        self.assertFalse(any(r['status'] == 'FAIL' for r in rows))
        self.assertTrue(any(r['code'] == 'integration' and r['status'] == 'WARN' for r in rows))

    def test_bad_hash(self):
        self.data['package']['sha256'] = '0' * 64
        self.assert_failure('hash')

    def test_nested_exe(self):
        self.rewrite_zip([('demo/demo.exe', b'MZ')])
        self.assert_failure('zip-entrypoint')

    def test_traversal(self):
        self.rewrite_zip([('../demo.exe', b'MZ')])
        self.assert_failure('zip-path')

    def test_case_collision(self):
        self.rewrite_zip([('demo.exe', b'MZ'), ('DEMO.EXE', b'MZ')])
        self.assert_failure('zip-path')

    def test_file_directory_collision(self):
        self.rewrite_zip([('demo.exe', b'MZ'), ('deps', b'x'), ('deps/file', b'x')])
        self.assert_failure('zip-conflict')

    def test_link(self):
        info = zipfile.ZipInfo('demo.exe')
        info.create_system = 3
        info.external_attr = (0o120777 << 16)
        self.rewrite_zip([(info, b'destination')])
        self.assert_failure('zip-path')

    def test_not_exe(self):
        self.rewrite_zip([('demo.exe', b'not exe')])
        self.assert_failure('zip-mz')

    def test_broken_zip(self):
        self.package.write_bytes(b'not zip')
        self.assert_failure('input-error')

    def test_wrong_schema_type(self):
        self.data['package'] = []
        self.assert_failure('schema')

    def test_platform(self):
        self.data['platform'] = 'darwin'
        self.assert_failure('platform')

    def test_missing_icon(self):
        self.data['iconPath'] = 'missing.ico'
        self.assert_failure('iconPath')


if __name__ == '__main__':
    unittest.main(verbosity=2)
