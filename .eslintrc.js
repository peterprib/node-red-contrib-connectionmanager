module.exports = {
    "env": {
        "es6": true,
        "mocha": true,
        "node": true
    },
    "extends": [
        "eslint:recommended",
	"plugin:mocha/recommended"
    ],
    "globals": {
        "Atomics": "readonly",
        "SharedArrayBuffer": "readonly"
    },
    "parserOptions": {
        "ecmaFeatures": {
            "jsx": true
        },
        "ecmaVersion": 2018,
        "sourceType": "module"
    },
    "plugins": [
	"mocha"
    ],
    "rules": {
    }
};