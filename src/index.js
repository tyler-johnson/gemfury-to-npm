
// get list of gemfury modules
// for each module
//	 get npm package versions
//	 for each gemfury version
//		 skip module if version exists
//		 download tar file
//		 clean package.json for re-release
//		 publish tar file to npm
//	 set npm latest to newest release between npm and gemfury

import {exec as _exec} from "child_process";
import promisify from "es6-promisify";
import superagent from "superagent";
import pkgjson from "package-json";
import ProgressBar from "progress";
import chalk from "chalk";
import {includes,padEnd,padStart} from "lodash";
import {extract,pack} from "tar-stream";
import gzip from "gunzip-maybe";
import fs from "fs-promise";
import {tmpdir} from "os";
import {basename} from "path";

const exec = promisify(_exec, function(err, [stdout, stderr]) {
	if (err) {
		err.stdout = stdout;
		err.stderr = stderr;
		this.reject(err);
	} else {
		this.resolve(stdout);
	}
});

function trimOrPadEnd(str, len) {
	let s = padEnd(str, len, " ");
	if (s.length > 10) s = s.substr(0, len);
	return s;
}

function trimOrPadStart(str, len) {
	let s = padStart(str, len, " ");
	if (s.length > 10) s = s.substr(0, len);
	return s;
}

export default async function({user,apikey}) {
	const gemfuryUrl = `https://npm.fury.io/${apikey}/${user}`;
	const tokens = {
		get _stage() { return trimOrPadEnd(this.stage, 20); },
		get _module() { return trimOrPadEnd(this.module, 30); },
		get _current() {
			return trimOrPadStart(this.current, this.count.toString().length);
		}
	};
	const progress = new ProgressBar(`[ :_current / :count ] ${chalk.bold(":_module")} ${chalk.blue(":_stage")} ${chalk.inverse("[:bar]")} ${chalk.dim(":percent")}`, {
		total: 100,
		width: 30,
		clear: true
	});

	function update(amt, stage) {
		if (stage) tokens.stage = stage;
		progress.update(amt, tokens);
	}

	function warn() {
		progress.stream.clearLine();
		progress.stream.cursorTo(0);
		console.warn.apply(console, arguments);
		progress.lastDraw = null;
		progress.render(tokens);
	}

	// get list of gemfury modules
	let {body:moduleNames} = await superagent.get(gemfuryUrl);
	let namesToPublish = moduleNames.slice(0);
	tokens.count = moduleNames.length;
	tokens.current = 0;

	// for each module
	while (namesToPublish.length) {
		try {
			let moduleName = tokens.module = namesToPublish.shift();
			tokens.current++;

			// get gemfury data
			update(0, "Gemfury Fetch");
			let {body:gemfuryPkg} = await superagent.get(gemfuryUrl + "/" + encodeURIComponent(moduleName));

			// get npm package versions
			update(0.05, "NPM Fetch");
			let npmPkg;
			try { npmPkg = await pkgjson(moduleName); }
			catch(e) {
				if (!/doesn't exist/.test(e.message)) throw e;
			}
			let npmVersions = npmPkg ? Object.keys(npmPkg.versions) : [];

			// for each gemfury version
			let versionsToProcess = Object.keys(gemfuryPkg.versions);
			let versionCount = versionsToProcess.length;
			let versionTick = () => 1 - (versionsToProcess.length / versionCount);
			let publishedCount = 0;

			while (versionsToProcess.length) {
				let version = versionsToProcess.shift();
				update(0.1 + (0.85*versionTick()), version);

				// skip module if version exists
				if (includes(npmVersions, version)) {
					warn("Skipping %s@%s because it already exists in NPM.", moduleName, version);
					continue;
				}

				let tarpath = tmpdir() + "/package.tgz";

				await new Promise((resolve, reject) => {
					// download tar file
					let req = superagent.get(gemfuryPkg.versions[version].dist.tarball);
					let tarin = extract();
					let unzip = gzip();
					let tarout = pack();
					let out = fs.createWriteStream(tarpath);

					req.on("error", reject);
					unzip.on("error", reject);
					tarin.on("error", reject);
					tarout.on("error", reject);
					out.on("error", reject);

					out.on("finish", resolve);
					tarin.on("finish", () => tarout.finalize());

					tarin.on("entry", (header, stream, next) => {
						if (basename(header.name) !== "package.json") {
							stream.pipe(tarout.entry(header, next));
							return;
						}

						let buf = "";
						stream.setEncoding("utf-8");
						stream.on("data", (c) => buf += c);
						stream.on("error", next);

						stream.on("end", () => {
							let data = JSON.parse(buf);
							if (data.private) delete data.private;
							if (data.scripts && data.scripts.prepublish) {
								delete data.scripts.prepublish;
							}

							let src = JSON.stringify(data, null, 2);
							tarout.entry({
								...header,
								size: src.length
							}, src);
							next();
						});
					});

					req.pipe(unzip).pipe(tarin);
					tarout.pipe(out);
				});

				try {
					await exec(`npm publish "${tarpath}"`);
				} catch(e) {
					if (!e.stderr) throw e;
					warn(e.stderr);
				}

				publishedCount++;
			}

			update(1, "");
			console.log("[ %s / %s ] %s %s %s", tokens._current, tokens.count, chalk.bold(tokens._module), chalk.blue(trimOrPadEnd(`${publishedCount} Versions`, 20)), chalk.green.bold("✓"));
		} catch(e) {
			warn(e.toString || e);
		}
	}
}
