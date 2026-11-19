const cp = require('child_process');
const fs = require('fs');
fs.writeFileSync('test.cpp', '#include<iostream>\nint main() { int age; std::cin >> age; std::cout << age; return 0; }');
cp.exec(g++ "test.cpp" -o "test.exe" && "test.exe", (err, stdout, stderr) => {
    console.log(JSON.stringify({
        errmessage: err ? err.message : null,
        stdout: stdout,
        stderr: stderr
    }, null, 2));
});
