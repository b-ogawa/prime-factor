const fs = require('fs');
const content = fs.readFileSync('js/core/math.js', 'utf8');
console.log(content.includes('strongLucasTest'));
