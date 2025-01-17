#!/usr/bin/env node

require('source-map-support').install();

const fs = require("fs-extra");
const path = require("path");
const cspawn = require("cross-spawn");
const enquirer = require('enquirer');

// REGEXES
const NEWLINE_REGEX = /\n+/m;

// CONSTANT VALUES
const DEFAULT_HEROLIMIT = 27;

// PATHS
const INI_PATH = "config.ini";
const MUA_RESOURCES = "mua";
const XML2_RESOURCES = "xml2";

const MUA_NAME = "Marvel Ultimate Alliance";
const XML2_NAME = "X-Men Legends 2";

const herostatOutputPath = path.resolve("temp", "herostat.xmlb");

// OPTIONS
const XML2_ROSTER_SIZES = new Map([["PC (21)", 21], ["Console (19)", 19], ["PSP (23)", 23]]);

// Shared Options Object
let options = {};

let useXMLFormatOnly = true;

const main = async (automatic = false, xml2 = false) => {
  const resourcePath = xml2 ? XML2_RESOURCES : MUA_RESOURCES;
  //clear temp folder
  fs.removeSync("temp");
  fs.mkdirSync("temp", { recursive: true });

  //find config file
  const configPath = path.resolve(resourcePath, INI_PATH);

  if (xml2) {
    options = {
      rosterSize: null,
      rosterValue: null,
      gameInstallPath: null,
      exeName: null,
      herostatName: null,
      launchGame: null,
      saveTempFiles: null,
      showProgress: null,
      debugMode: null
    };
  } else {
    options = {
      menulocationsValue: null,
      rosterHack: null,
      rosterValue: null,
      gameInstallPath: null,
      exeName: null,
      herostatName: null,
      launchGame: null,
      saveTempFiles: null,
      showProgress: null,
      debugMode: null
    };
  }

  let saveOptions = false;
  let skipOptionsPrompts = false;

  let readOptions = null;
  //check for existing config and load it if available
  if (fs.existsSync(configPath)) {
    try {
      readOptions = JSON.parse(fs.readFileSync(configPath, "utf8"));
      //verify each options value is valid and only load valid keys
      Object.keys(options).forEach(item => {
        options[item] = (readOptions[item] !== undefined && readOptions[item] !== null)
          ? readOptions[item]
          : options[item];
      });
    } catch (e) {
      console.error("Found malformed config.ini file");
      readOptions = null;
    }
  }

  if (automatic) {
    //run in automatic mode, bypassing option prompts if available
    if (readOptions) {
      console.log("Running in automatic mode, using options below:");
      console.log(JSON.stringify(options, null, 2));
    } else {
      console.error("Missing or malformed config.ini file.");
      throw new Error("Missing or malformed config.ini file.");
    }
  } else {
    //prompt for options
    if (readOptions) {
      //ask to use existing config.ini options if found
      console.log("Found existing saved options below:");
      console.log(JSON.stringify(options, null, 2));
      skipOptionsPrompts = await new enquirer.Confirm({
        name: 'skipoptions',
        message: 'Use saved options from config.ini file?',
        initial: true
      }).run();
    }

    if (!skipOptionsPrompts) {
      //if config.ini not found, or decided to change options, prompt

      if (!xml2) {
        options.rosterHack = await new enquirer.Confirm({
          name: 'rosterhack',
          message: 'Do you have a roster size hack installed?',
          initial: false
        }).run();

        const menulocationOptions = fs.readdirSync(path.resolve(resourcePath, "menulocations"))
          .filter((item) => item.toLowerCase().endsWith(".cfg"))
          .map((item) => item.slice(0, item.length - 4));
        options.menulocationsValue = await new enquirer.Select({
          name: 'menulocations',
          message: 'Select a roster layout',
          choices: [...menulocationOptions],
          initial: "27"
        }).run();
        if (!options.menulocationsValue.trim()) {
          options.menulocationsValue = "27";
        } else if (!menulocationOptions.includes(options.menulocationsValue)) {
          console.error("ERROR: Invalid roster layout");
          throw new Error("ERROR: Invalid roster layout");
        }
      } else {
        const rosterSizeChoices = Array.from(XML2_ROSTER_SIZES.keys());
        options.rosterSize = XML2_ROSTER_SIZES.get(await new enquirer.Select({
          name: 'rostersize',
          message: 'Select a roster size (platform)',
          choices: rosterSizeChoices,
          initial: rosterSizeChoices[0]
        }).run());
      }

      const rosterOptions = fs.readdirSync(path.resolve(resourcePath, "rosters"))
        .filter((item) => item.toLowerCase().endsWith(".cfg"))
        .map((item) => item.slice(0, item.length - 4));
      options.rosterValue = await new enquirer.Select({
        name: 'rosters',
        message: 'Select a roster',
        choices: [...rosterOptions]
      }).run();
      if (!rosterOptions.includes(options.rosterValue)) {
        console.error("ERROR: Invalid roster");
        throw new Error("ERROR: Invalid roster");
      }

      options.gameInstallPath = path.resolve(
        (await new enquirer.Input({
          name: 'installpath',
          message: `Path to your installation of ${xml2 ? XML2_NAME : MUA_NAME} (you can just paste this in, right-click to paste)`,
          initial: xml2 ? "C:\\Program Files (x86)\\Activision\\X-Men Legends 2" : "C:\\Program Files (x86)\\Activision\\Marvel - Ultimate Alliance"
        }).run()
        ).trim());
      options.exeName = (await new enquirer.Input({
        name: 'exename',
        message: `The filename of your game's exe (the default is usually fine unless using a modpack)`,
        initial: xml2 ? "XMen2.exe" : "Game.exe"
      }).run()
      ).trim();
      options.herostatName = (await new enquirer.Input({
        name: 'herostatname',
        message: `The filename of your game's herostat (the default is usually fine unless using a modpack)`,
        initial: "herostat.engb"
      }).run()
      ).trim();
      options.launchGame = await new enquirer.Confirm({
        name: 'launchgame',
        message: 'Launch the game when done?',
        initial: false
      }).run();
      options.saveTempFiles = await new enquirer.Confirm({
        name: 'savetemp',
        message: 'Save the intermediate temp files?',
        initial: false
      }).run();
      options.showProgress = await new enquirer.Confirm({
        name: 'showprogress',
        message: 'Show progress? (Leaving this disabled provides a performance boost.)',
        initial: false
      }).run();
      options.debugMode = await new enquirer.Confirm({
        name: 'debugMode',
        message: 'Test herostats? (Shows more details on errors, but reduces performance.)',
        initial: false
      }).run();
      saveOptions = await new enquirer.Confirm({
        name: 'teamcharacterincluded',
        message: 'Save these options to config.ini file?',
        initial: true
      }).run();
    }

    //begin writing progress
    writeProgress(0);

    //write options to config if desired
    if (saveOptions) {
      fs.writeFileSync(configPath, JSON.stringify(options, null, 2));
    }
  }

  //load chosen roster and menulocations
  const rosterFile = path.resolve(resourcePath, "rosters", `${options.rosterValue}.cfg`);
  const rosterData = fs.readFileSync(path.resolve(rosterFile), "utf8");
  const rosterList = rosterData
    .split(NEWLINE_REGEX)
    .filter((item) => item.trim().length)
    .map((item) => item.trim());

  let menulocations = [];
  if (!xml2) {
    const menulocationsFile = path.resolve(resourcePath, "menulocations", `${options.menulocationsValue}.cfg`);
    const menulocationsData = fs.readFileSync(menulocationsFile, "utf8");
    menulocations = menulocationsData
      .split(NEWLINE_REGEX)
      .filter((item) => item.trim().length)
      .map((item) => parseInt(item.trim()));
  } else {
    //workaround for herostat loop since xml2 doesn't use menulocations
    menulocations = new Array(options.rosterSize);
  }

  let operations = rosterList.length + menulocations.length + 6;
  let progressPoints = 0;

  //check if any json herostat exists
  rosterList.forEach((item) => {
    if (fs.existsSync(path.resolve(resourcePath, "json", `${item}.json`))) {
      useXMLFormatOnly = false;
    }
  });

  // CONSTANT HEROSTAT PIECES
  const CHARACTERS_START = useXMLFormatOnly
    ? `XMLB characters {
`
    : `{
  "characters": {
`;
  const CHARACTERS_END = useXMLFormatOnly
    ? `
}
`
    : `
  }
}
`;
  const DEFAULTMAN = useXMLFormatOnly
    ? `   stats {
   autospend = support_heavy ;
   body = 1 ;
   characteranims = 00_testguy ;
   charactername = defaultman ;
   level = 1 ;
   menulocation = 0 ;
   mind = 1 ;
   name = default ;
   skin = 0002 ;
   strength = 1 ;
   team = enemy ;
      talent {
      level = 1 ;
      name = fightstyle_default ;
      }

   }`
    : `"stats": {
  "autospend": "support_heavy",
  "body": 1,
  "characteranims": "00_testguy",
  "charactername": "defaultman",
  "level": 1,
  "menulocation": 0,
  "mind": 1,
  "name": "default",
  "skin": "0002",
  "strength": 1,
  "team": "enemy",
  "talent": {
      "level": 1,
      "name": "fightstyle_default"
  }
}`;
  const DEFAULTMAN_XML2 = useXMLFormatOnly
    ? `   stats {
   autospend = support_heavy ;
   body = 1 ;
   characteranims = 00_testguy ;
   charactername = defaultman ;
   level = 1 ;
   mind = 1 ;
   name = default ;
   skin = 0002 ;
   strength = 1 ;
      Race {
      name = Mutant ;
      }

      Race {
      name = XMen ;
      }

      talent {
      level = 1 ;
      name = fightstyle_default ;
      }

   }`
    : `"stats": {
  "autospend": "support_heavy",
  "body": "1",
  "characteranims": "00_testguy",
  "charactername": "defaultman",
  "level": "1",
  "mind": "1",
  "name": "default",
  "skin": "0002",
  "speed": "1",
  "strength": "1",
  "Race": {
      "name": "Mutant"
  },
  "Race": {
      "name": "XMen"
  },
  "talent": {
      "level": "1",
      "name": "fightstyle_hero"
  }
}`;
  const TEAM_CHARACTER = useXMLFormatOnly
    ? `   stats {
   autospend = support ;
   isteam = true ;
   name = team_character ;
   skin = 0002 ;
   xpexempt = true ;
   }
`
    : `"stats": {
  "autospend": "support",
  "isteam": true,
  "name": "team_character",
  "skin": "0002",
  "xpexempt": true
}
`;

  //dynamic regexes
  const MENULOCATION_REGEX = useXMLFormatOnly ? /(^\s*menulocation\s*=\s*)\w+(\s*;\s*$)/m : /(^\s*"menulocation":\s*)"?\w+"?(,\s*$)/m;
  const STATS_REGEX = useXMLFormatOnly ? /^.*stats\s*{[\s\S]*}(?![\s\S]*})/m : /^.*"stats":\s*{[\s\S]*}(?![\s\S]*})/m;

  //load stat data for each character in roster
  const characters = [];
  rosterList.forEach((item) => {
    let fileData = "";
    if (useXMLFormatOnly) {
      //if no json herostat exists for the whole roster, load xml files
      fileData = fs.readFileSync(path.resolve(resourcePath, "xml", `${item}.xml`), "utf8");
    } else if (fs.existsSync(path.resolve(resourcePath, "json", `${item}.json`))) {
      //if json stats file exists, load that (json has priority)
      fileData = fs.readFileSync(path.resolve(resourcePath, "json", `${item}.json`), "utf8");
    } else if (fs.existsSync(path.resolve(resourcePath, "xml", `${item}.xml`))) {
      //if json file doesn't exist but xml does, convert to json and load it
      const filePath = path.resolve(resourcePath, "xml", `${item}.xml`);
      const tempFilePath = path.resolve("temp", `${item}.json`);
      cspawn.sync(path.resolve("xml2json.exe"), [filePath, tempFilePath], {});
      fileData = fs.readFileSync(tempFilePath, "utf8");
    } else {
      console.error(`ERROR: no json or xml found for ${item}`);
      throw new Error(`ERROR: no json or xml found for ${item}`);
    }

    //clean up loaded file and push to list of loaded character stats
    fileData = fileData.match(STATS_REGEX).join();

    characters.push(fileData);
    writeProgress(((++progressPoints) / operations) * 100);
  });

  if (characters.length < menulocations.length) {
    operations = operations - menulocations.length + characters.length;
  }

  //begin generating herostat
  let herostat = CHARACTERS_START;
  const comma = useXMLFormatOnly ? "\n" : ","; //no comma for xml format
  if (xml2) {
    //xml2 always has defaultman
    herostat += DEFAULTMAN_XML2 + comma + "\n";
  } else if (options.rosterHack || characters.length < DEFAULT_HEROLIMIT || menulocations.length < DEFAULT_HEROLIMIT) {
    //mua add defaultman unless no roster hack is installed and all 27 character slots are filled
    herostat += DEFAULTMAN + comma + "\n";
  }
  writeProgress(((++progressPoints) / operations) * 100);

  //adapt and add each character's stats to herostat
  for (let index = 0; index < menulocations.length && index < characters.length; ++index) {
    let heroValue = characters[index];
    if (!xml2) {
      //find and replace menulocation in stat with actual menulocation
      heroValue = heroValue.replace(
        MENULOCATION_REGEX,
        `$1${menulocations[index]}$2`
      );
    }
    //debug mode is new
    if (options.debugMode) {
      let dbgStat = CHARACTERS_START + heroValue + "\n" + CHARACTERS_END;
      compileHerostat(dbgStat, rosterList[index]);
    };
    //append to herostat with comma and newline
    herostat += heroValue;
    //skip the last comma for xml2 since there's no TEAM_CHARACTER
    if (!xml2 || (index + 1 < menulocations.length && index + 1 < characters.length)) {
      herostat += comma;
    };
    herostat += "\n";
    writeProgress(((++progressPoints) / operations) * 100);
  }

  //add team_character for mua
  if (!xml2) {
    herostat += TEAM_CHARACTER;
  }

  //finish writing herostat
  herostat += CHARACTERS_END;
  writeProgress(((++progressPoints) / operations) * 100);

  //clear temp folder if not saving temp files
  if (!options.saveTempFiles) {
    fs.removeSync("temp");
    fs.mkdirSync("temp", { recursive: true });
  }
  writeProgress(((++progressPoints) / operations) * 100);

  //write herostat json to disk
  compileHerostat(herostat, 'herostat')
  writeProgress(((++progressPoints) / operations) * 100);

  //copy converted herostat to game data directory
  fs.copyFileSync(
    herostatOutputPath,
    path.resolve(options.gameInstallPath, "data", options.herostatName)
  );
  writeProgress(((++progressPoints) / operations) * 100);

  //clear temp folder if not saving temp files
  if (!options.saveTempFiles) {
    fs.removeSync("temp");
  }
  writeProgress(((++progressPoints) / operations) * 100);

  //launch game if desired
  if (options.launchGame) {
    const gameProc = cspawn(path.resolve(options.gameInstallPath, options.exeName), {
      detached: true
    });
    gameProc.unref();
  }
};

function writeProgress(percent) {
  if (!options.showProgress) {
    return;
  }
  process.stdout.clearLine();
  process.stdout.cursorTo(0);
  process.stdout.write(percent === 100 ? "Done\n" : `Working, please wait... (${percent.toFixed(1)}%)`);
}

function compileHerostat(stats, statname) {
  const ext = useXMLFormatOnly ? `xml` : `json`;
  const herostatXmlPath = path.resolve("temp", "herostat.xml");
  const herostatJsonPath = path.resolve("temp", "herostat.json");
  fs.writeFileSync(path.resolve("temp", `herostat.${ext}`), stats);
  if (useXMLFormatOnly) {
    cspawn.sync(path.resolve("xml2json.exe"), [herostatXmlPath, herostatJsonPath], {});
  }

  //generate herostat xmlb file
  const child = cspawn.sync(
    path.resolve("json2xmlb.exe"),
    [herostatJsonPath, herostatOutputPath],
    {}
  );
  if (child.stdout == '') {
    throw statname + ":\n" + child.stderr.toString('utf8').split("\n").slice(-3).join('\n');
  }
}

module.exports = main;
