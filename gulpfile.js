const gulp = require('gulp');
const ts = require('gulp-typescript');
const del = require('del');

const tsProject = ts.createProject('tsconfig.json');

const SOURCE_DIRECTORY_PATH = 'src';
const DESTINATION_DIRECTORY_PATH = 'dist';

function cleanTask() {
  return del(DESTINATION_DIRECTORY_PATH);
}

function compileTypeScriptTask() {
  return tsProject.src()
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
    compileTypeScriptTask,
    watchTask
  ),
  build: gulp.series(
    cleanTask,
    compileTypeScriptTask
  ),
};
