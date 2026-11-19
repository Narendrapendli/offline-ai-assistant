#include <iostream>
int main() {
    int age;
    std::cout << "Enter your age: ";
    std::cin >> age;
    if (age >= 18) { std::cout << "You are eligible." << std::endl; }
    for (int i=0; i<10; i++) std::cout << i << std::endl;
    return 0;
}
