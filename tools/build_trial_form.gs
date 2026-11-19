/**
 * Builds the trial sign-up form in your Google account.
 *
 * How to run:
 *   1. Go to https://script.google.com and press "New project".
 *   2. Delete the sample code, paste this whole file in, and save.
 *   3. Choose buildTrialForm in the function dropdown and press Run.
 *   4. Approve the permission prompt (it creates a Form and a Sheet).
 *   5. Open "Execution log" for the edit link and the link to share.
 */

var FORM_TITLE = 'Darts auto-scoring trial: tell us about your setup';
var FORM_DESCRIPTION =
  'Thanks for offering to trial the app. These questions take about 3 minutes ' +
  'and help us work out which devices and cameras to support first.';

function buildTrialForm() {
  var form = FormApp.create(FORM_TITLE);
  form.setDescription(FORM_DESCRIPTION);
  form.setProgressBar(true);

  // ---------- helpers ----------
  function text(title, required, help) {
    var item = form.addTextItem().setTitle(title).setRequired(!!required);
    if (help) item.setHelpText(help);
    return item;
  }
  function paragraph(title, help) {
    var item = form.addParagraphTextItem().setTitle(title).setRequired(false);
    if (help) item.setHelpText(help);
    return item;
  }
  function choice(title, options, opts) {
    opts = opts || {};
    var item = form.addMultipleChoiceItem().setTitle(title)
      .setChoiceValues(options).setRequired(opts.required !== false);
    if (opts.other) item.showOtherOption(true);
    if (opts.help) item.setHelpText(opts.help);
    return item;
  }
  function checkboxes(title, options, opts) {
    opts = opts || {};
    var item = form.addCheckboxItem().setTitle(title)
      .setChoiceValues(options).setRequired(opts.required !== false);
    if (opts.other) item.showOtherOption(true);
    if (opts.help) item.setHelpText(opts.help);
    return item;
  }
  function dropdown(title, options) {
    return form.addListItem().setTitle(title).setChoiceValues(options).setRequired(true);
  }
  function section(title, help) {
    var page = form.addPageBreakItem().setTitle(title);
    if (help) page.setHelpText(help);
    return page;
  }

  // ---------- Section 1: About you ----------
  form.addSectionHeaderItem().setTitle('About you');

  text('Name or nickname', true);

  text('Email', true, 'Only used to send you trial invites.')
    .setValidation(FormApp.createTextValidation()
      .setHelpText('Please enter a valid email address.')
      .requireTextIsEmail()
      .build());

  choice('Where do you mostly play?', [
    'Home, on my own board',
    'Pub or club',
    'Both'
  ]);

  choice('How comfortable are you with tech setup?', [
    'I just want to install an app',
    'I can follow a step-by-step guide',
    'Happy with a Raspberry Pi or the command line'
  ]);

  // ---------- Section 2: What you use now ----------
  section('What you use now');

  checkboxes('How do you score today?', [
    'Autodarts',
    'DartCounter',
    'Scolia',
    'Target DartCounter / Omni',
    'My own app',
    'Chalk or pen and paper'
  ], { other: true, help: 'Tick all that apply. Use "Other" to name another app.' });

  paragraph('What do you like most about it, and what annoys you?');

  choice('Do you pay for it?', [
    'No',
    'Yes, a one-off purchase',
    'Yes, a subscription'
  ]);

  text('If you pay, roughly how much?', false, 'For example "£5 a month" or "£20 once".');

  // ---------- Section 3: Cameras (branches) ----------
  section('Cameras');

  // Choices are set further down, once the sections they jump to exist.
  var hasCameras = form.addMultipleChoiceItem()
    .setTitle('Do you have cameras pointed at your board?')
    .setRequired(true);

  // ---------- Section 3b: Your cameras (only if dedicated cameras) ----------
  var cameraDetails = section('Your cameras');

  choice('How many cameras?', ['1', '2', '3', '4 or more']);

  choice('Which cameras are they?', [
    'OV9732-type USB modules (the usual Autodarts ones)',
    'Standard webcams',
    'Not sure'
  ], { other: true, help: 'Use "Other" to give the make or model.' });

  choice('How are they mounted?', [
    'On a light ring',
    'Printed or custom mounts',
    'Tripod or stand'
  ], { other: true });

  text('If they are on a light ring, which one?', false, 'For example "Target Corona Vision".');

  choice('What are the cameras plugged into?', [
    'Raspberry Pi',
    'Windows PC',
    'Mac',
    'Linux PC',
    'Mini PC'
  ], { other: true });

  // ---------- Section 4: Devices ----------
  var devices = section('Your devices');

  var deviceOptions = [
    'iPhone',
    'Android phone',
    'iPad',
    'Android tablet',
    'Amazon Fire tablet',
    'Windows laptop or PC',
    'Mac',
    'TV or monitor by the board'
  ];

  checkboxes('What would you show the scoreboard on?', deviceOptions,
    { help: 'Tick everything you might use.' });

  dropdown('Which would be your main one?', deviceOptions);

  choice('Is there a computer that could stay switched on near the board?', [
    'Yes, a Raspberry Pi',
    'Yes, a Windows PC',
    'Yes, a Mac',
    'Yes, a Linux PC',
    'No, phone or tablet only'
  ]);

  text('If it is a Raspberry Pi, which model?', false, 'For example "Pi 4, 4 GB" or "Pi 5".');

  choice('Roughly how old is your main device?', [
    'Under 2 years',
    '2 to 5 years',
    'Over 5 years'
  ]);

  // ---------- Section 5: Board and room ----------
  section('Your board and room');

  choice('What lighting does your board have?', [
    'A ring light (for example Corona Vision)',
    'Another dedicated light',
    'Room lighting only'
  ]);

  choice('Is your board a standard red and green bristle board?', [
    'Yes',
    'No, different colours',
    'Not sure'
  ]);

  choice('How is the Wi-Fi at your board?', ['Good', 'Patchy', 'None']);

  // ---------- Section 6: The trial ----------
  section('The trial');

  choice('Would you buy hardware to get automatic scoring?', [
    'No, only what I already own',
    'Yes, up to £50',
    'Yes, up to £100',
    'Yes, more than £100'
  ]);

  checkboxes('Which games do you play most?', [
    '501 / 301',
    'Cricket',
    'Killer',
    'Around the Clock',
    'Practice routines'
  ], { other: true });

  choice('Do you want to play online against other people?', [
    'Must have',
    'Nice to have',
    "Don't care"
  ]);

  paragraph('Anything else we should know?');

  // ---------- wire up the camera branch ----------
  hasCameras.setChoices([
    hasCameras.createChoice('Yes, dedicated cameras', cameraDetails),
    hasCameras.createChoice("No, but I'd use my phone or tablet camera", devices),
    hasCameras.createChoice('No cameras', devices)
  ]);

  // ---------- responses go to a new spreadsheet ----------
  var sheet = SpreadsheetApp.create(FORM_TITLE + ' (responses)');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, sheet.getId());

  Logger.log('Edit the form:   ' + form.getEditUrl());
  Logger.log('Share this link: ' + form.getPublishedUrl());
  Logger.log('Responses sheet: ' + sheet.getUrl());
}
