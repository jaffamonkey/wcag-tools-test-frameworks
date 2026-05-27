module.exports = {
  default: {
    paths: ['e2e/**/*.feature'],
    require: [
      'cucumber/step_definitions/**/*.js'
    ],
    format: ['progress'],
    publishQuiet: true
  }
};
