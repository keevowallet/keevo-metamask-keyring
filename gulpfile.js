const gulp = require('gulp');
const replace = require('gulp-replace');
const ts = require('gulp-typescript');
const del = require('del');

const tsProject = ts.createProject('tsconfig.json');

const SOURCE_DIRECTORY_PATH = 'src';
const DESTINATION_DIRECTORY_PATH = 'dist';

function cleanTask() {
  console.log('Cleaning');

  return del(DESTINATION_DIRECTORY_PATH);
}

function preBuildCheckTask() {
  console.log('Checking ENV');

  const popupUrl = process.env.KEEVO_WEBSOCKET_BRIDGE_POPUP_URL;

  if (!popupUrl) {
    console.error('Popup URL is not specified');

    throw new Error('Popup URL is not specified');
  }

  if (typeof popupUrl !== 'string') {
    console.error('Popup URL is not a string');

    throw new Error('Popup URL is not a string');
  }

  if (!/^https:\/\//.test(popupUrl)) {
    console.error('Popup URL is not starts with "https://"');

    throw new Error('Popup URL is not starts with "https://"');
  }

  return Promise.resolve(true);
}

function compileTypeScriptTask() {
  console.log('Compiling');

  return tsProject.src()
    // In general is not reliable to check directly by string, but in our case it is ok
    .pipe(replace('process.env.KEEVO_WEBSOCKET_BRIDGE_POPUP_URL', `'${process.env.KEEVO_WEBSOCKET_BRIDGE_POPUP_URL}'`))
    .pipe(tsProject()).js
    .pipe(gulp.dest(DESTINATION_DIRECTORY_PATH))
}

function watchTask() {
  return gulp.watch(
    `${SOURCE_DIRECTORY_PATH}/**/*.ts`,
    compileTypeScriptTask
  );
}

module.exports = {
  watch: gulp.series(
    cleanTask,
    preBuildCheckTask,
    compileTypeScriptTask,
    watchTask
  ),
  build: gulp.series(
    cleanTask,
    preBuildCheckTask,
    compileTypeScriptTask
  ),
};
