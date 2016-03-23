import minimist from "minimist";
const {name,version="edge"} = require("./package.json");

// using standard require so rollup doesn't include it
const gemfuryToNPM = require("./");

let argv = minimist(process.argv.slice(2), {
	string: [ ],
	boolean: [ "help", "version" ],
	alias: {
		h: "help", H: "help",
		v: "version", V: "version"
	}
});

if (argv.help) {
	console.log("halp plz");
	process.exit(0);
}

if (argv.version) {
	console.log("%s %s", name, version);
	process.exit(0);
}

function panic(e) {
	console.error(e.stack || e);
	process.exit(1);
}

gemfuryToNPM(argv).catch(panic);
