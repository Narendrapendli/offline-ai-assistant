const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const id = 'r8fxrq9v5';
const tmpDir = os.tmpdir();
const tmpFile = path.join(tmpDir, `ai_snippet_.cpp`);
const exeFile = path.join(tmpDir, `ai_snippet_.exe`);

const code = #include <iostream>
int main() {
    int age;
    std::cout << "Enter your age: ";
    std::cin >> age;
    if (age >= 18) std::cout << "Eligible\n";
    else std::cout << "Not eligible\n";
    for (int i = 0; i < 10; i++) std::cout << i << std::endl;
    return 0;
};

fs.writeFileSync(tmpFile, code);
const command = `g++ "" -o "" && ""`;

cp.exec(command, { timeout: 10000 }, (error, stdout, stderr) => {
    console.log(JSON.stringify({
        error: error ? error.message : null,
        stdout: stdout,
        stderr: stderr
    }, null, 2));
});
