'use strict';

var io = require('socket.io-client');
var fs = require('fs-extra');
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;
var libQ = require('kew');
var libFsExtra = require('fs-extra');
var spawn = require('child_process').spawn;

var ignoreUsbAudioDetach = false;
var ignoreUsbAudioAttach = false;
var volumioDeviceName = '';
var additionalUISections = [];
var deviceVolumeOverride;
var overrideAvoidSoftwareMixer = false;
var overrideMixerType;

// Define the ControllerAlsa class
module.exports = ControllerAlsa;
function ControllerAlsa (context) {
  this.context = context;
  this.commandRouter = this.context.coreCommand;
  this.logger = this.context.logger;
  this.configManager = this.context.configManager;
}

ControllerAlsa.prototype.onVolumioStart = function () {
  var self = this;

  var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');

  this.config = new (require('v-conf'))();
  this.config.loadFile(configFile);

  var volumeval = this.config.get('volumestart');

  var socketURL = 'http://localhost:3000';
  var options = {
    transports: ['websocket'],
    'force new connection': true
  };

  var client1 = io.connect(socketURL, options);

  if (volumeval != 'disabled') {
    setTimeout(function () {
      exec('/volumio/app/plugins/system_controller/volumio_command_line_client/volumio.sh volume ' + volumeval, {uid: 1000, gid: 1000, encoding: 'utf8'}, function (error, stdout, stderr) {
        if (error) {
          self.logger.error('Cannot set startup volume: ' + error);
        } else {
          self.logger.info('Setting volume on startup at ' + volumeval);
        }
      });
    }, 5000);
  }

  if (this.config.has('outputdevice') == false) {
    this.config.addConfigValue('outputdevice', 'string', '0');
    this.updateVolumeSettings();
  }
  if (this.config.has('mixer') == false) {
    var value = this.config.get('outputdevice');
    this.setDefaultMixer(value);
    this.updateVolumeSettings();
  }

  if (this.config.has('volumesteps') == false) {
    this.config.addConfigValue('volumesteps', 'string', '10');
    this.updateVolumeSettings();
  }

  self.logger.debug("Creating shared var alsa.outputdevice='" + this.config.get('outputdevice') + "'");
  this.commandRouter.sharedVars.addConfigValue('alsa.outputdevice', 'string', this.config.get('outputdevice'));
  this.commandRouter.sharedVars.addConfigValue('alsa.outputdevicemixer', 'string', this.config.get('mixer'));
  this.commandRouter.sharedVars.registerCallback('alsa.outputdevice', this.outputDeviceCallback.bind(this));

  self.checkMixer();

  return libQ.resolve();
};

ControllerAlsa.prototype.getUIConfig = function () {
  var self = this;

  var defer = libQ.defer();

  var lang_code = this.commandRouter.sharedVars.get('language_code');

  self.commandRouter.i18nJson(__dirname + '/../../../i18n/strings_' + lang_code + '.json',
    __dirname + '/../../../i18n/strings_en.json',
    __dirname + '/UIConfig.json')
    .then(function (uiconf) {
      var value;
      var devicevalue;
      var outdevicename;

      var cards = self.getAlsaCards();
      var i2soptions = self.commandRouter.executeOnPlugin('system_controller', 'i2s_dacs', 'getI2sOptions');
      var i2sstatus = self.commandRouter.executeOnPlugin('system_controller', 'i2s_dacs', 'getI2sStatus');

      value = self.config.get('outputdevice');
      if (value == undefined) {
        value = 0;
      } else if (value == 'softvolume') {
        value = self.config.get('softvolumenumber');
      }
      var cardnum = value;

      if (i2sstatus.enabled) {
          // IF I2S DAC is enable we don't show it in output list
          var cardsWithoutI2SDAC = self.getAlsaCardsWithoutI2SDAC();
          var fullCardsList = cards;
          cards = cardsWithoutI2SDAC;
          outdevicename = self.getLabelForSelectedCard(fullCardsList, value);
          self.configManager.setUIConfigParam(uiconf, 'sections[0].content[0].value.value', cardsWithoutI2SDAC[0].id);
          var outdevicenameWithoutI2SDAC = self.getLabelForSelectedCard(cardsWithoutI2SDAC, cardsWithoutI2SDAC[0].id);
          self.configManager.setUIConfigParam(uiconf, 'sections[0].content[0].value.label', outdevicenameWithoutI2SDAC);
      } else {
          self.configManager.setUIConfigParam(uiconf, 'sections[0].content[0].value.value', value);
          var outdevicename = self.config.get('outputdevicename');
          if (outdevicename) {
              self.configManager.setUIConfigParam(uiconf, 'sections[0].content[0].value.label', outdevicename);
          } else {
              outdevicename = self.getLabelForSelectedCard(cards, value);
              self.configManager.setUIConfigParam(uiconf, 'sections[0].content[0].value.label', outdevicename);
          }
      }



      for (var i in cards) {
        if (cards[i].name === 'Audio Jack') {
          self.configManager.pushUIConfigParam(uiconf, 'sections[0].content[0].options', {
            value: cards[i].id,
            label: 'Audio Jack'
          });
          self.configManager.pushUIConfigParam(uiconf, 'sections[0].content[0].options', {
            value: cards[i].id,
            label: 'HDMI Out'
          });
        } else {
          if (cards[i].id == '5') {
            cards[i].name = 'USB: ' + cards[i].name;
          }
          self.configManager.pushUIConfigParam(uiconf, 'sections[0].content[0].options', {
            value: cards[i].id,
            label: cards[i].name
          });
        }
      }

      if (i2soptions.length > 0) {
        if (i2sstatus.enabled) {
          self.configManager.setUIConfigParam(uiconf, 'sections[0].content[1].value', i2sstatus.enabled);
          self.configManager.setUIConfigParam(uiconf, 'sections[0].content[2].value', {
            value: i2sstatus.id,
            label: i2sstatus.name
          });
        } else {
          self.configManager.setUIConfigParam(uiconf, 'sections[0].content[1].value', false);
          self.configManager.setUIConfigParam(uiconf, 'sections[0].content[2].value', {
            value: i2soptions[0].value,
            label: i2soptions[0].label
          });
        }

        self.configManager.setUIConfigParam(uiconf, 'sections[0].content[1].id', 'i2s');
        self.configManager.setUIConfigParam(uiconf, 'sections[0].content[1].hidden', false);
        self.configManager.pushUIConfigParam(uiconf, 'sections[0].saveButton.data', 'i2s');
        self.configManager.pushUIConfigParam(uiconf, 'sections[0].saveButton.data', 'i2sid');
        self.configManager.setUIConfigParam(uiconf, 'sections[0].content[1].label', 'I2S DAC');
        self.configManager.setUIConfigParam(uiconf, 'sections[0].content[1].element', 'switch');
        self.configManager.setUIConfigParam(uiconf, 'sections[0].content[2].id', 'i2sid');
        self.configManager.setUIConfigParam(uiconf, 'sections[0].content[2].element', 'select');
        self.configManager.setUIConfigParam(uiconf, 'sections[0].content[2].label', 'DAC Model');

        for (var i in i2soptions) {
          self.configManager.pushUIConfigParam(uiconf, 'sections[0].content[2].options', {
            value: i2soptions[i].value,
            label: i2soptions[i].label
          });
        }
      }

      if (volumioDeviceName === 'primo') {
        uiconf.sections[0].content[1].hidden = true;
      }

      var mixers = self.getMixerControls(value);
      var activemixer = self.config.get('mixer');
      var activemixer_type = self.config.get('mixer_type');
      if (overrideMixerType !== undefined) {
          activemixer_type = overrideMixerType;
      }

      self.configManager.setUIConfigParam(uiconf, 'sections[3].content[0].element', 'select');
      self.configManager.setUIConfigParam(uiconf, 'sections[3].content[0].label', self.commandRouter.getI18nString('PLAYBACK_OPTIONS.MIXER_TYPE'));
      if (activemixer_type == 'None') {
        var activemixer_type_lang = self.commandRouter.getI18nString('COMMON.NONE');
        self.configManager.setUIConfigParam(uiconf, 'sections[3].content[1].hidden', true);
        self.configManager.setUIConfigParam(uiconf, 'sections[3].content[2].hidden', true);
        self.configManager.setUIConfigParam(uiconf, 'sections[3].content[3].hidden', true);
        self.configManager.setUIConfigParam(uiconf, 'sections[3].content[4].hidden', true);
        self.configManager.setUIConfigParam(uiconf, 'sections[3].content[5].hidden', true);
        self.configManager.setUIConfigParam(uiconf, 'sections[3].content[6].hidden', true);
      } else if (activemixer_type == 'Software') {
        var activemixer_type_lang = self.commandRouter.getI18nString('PLAYBACK_OPTIONS.SOFTWARE');
        self.configManager.setUIConfigParam(uiconf, 'sections[3].content[1].hidden', true);
      } else if (activemixer_type == 'Hardware') {
        var activemixer_type_lang = self.commandRouter.getI18nString('PLAYBACK_OPTIONS.HARDWARE');
        self.configManager.setUIConfigParam(uiconf, 'sections[3].content[5].hidden', false);
      } else {
        var activemixer_type_lang = activemixer_type;
      }
      self.configManager.setUIConfigParam(uiconf, 'sections[3].content[0].value', {
        value: activemixer_type,
        label: activemixer_type_lang
      });

      if ((typeof mixers !== 'undefined') || (mixers != null)) {
        if ((mixers.length > 1) && (mixers[0] == 'SoftMaster' || activemixer == 'SoftMaster')) {
          self.configManager.pushUIConfigParam(uiconf, 'sections[3].content[0].options', {
            value: 'Hardware',
            label: self.commandRouter.getI18nString('PLAYBACK_OPTIONS.HARDWARE')
          });
        } else if ((mixers.length > 0) && (mixers[0] != 'SoftMaster') && (activemixer != 'SoftMaster')) {
          self.configManager.pushUIConfigParam(uiconf, 'sections[3].content[0].options', {
            value: 'Hardware',
            label: self.commandRouter.getI18nString('PLAYBACK_OPTIONS.HARDWARE')
          });
        }
      }
      // Hide software volume for Primo Analog out
      if ((volumioDeviceName === 'primo' && outdevicename === 'Analog RCA Output') || overrideAvoidSoftwareMixer === true) {
        var avoidSoftwareMixer = true;
      }

      if (!avoidSoftwareMixer) {
        self.configManager.pushUIConfigParam(uiconf, 'sections[3].content[0].options', {
          value: 'Software',
          label: self.commandRouter.getI18nString('PLAYBACK_OPTIONS.SOFTWARE')
        });
      }

      self.configManager.pushUIConfigParam(uiconf, 'sections[3].content[0].options', {
        value: 'None',
        label: self.commandRouter.getI18nString('COMMON.NONE')
      });

      self.configManager.setUIConfigParam(uiconf, 'sections[3].content[1].id', 'mixer');
      self.configManager.setUIConfigParam(uiconf, 'sections[3].content[1].element', 'select');
      self.configManager.setUIConfigParam(uiconf, 'sections[3].content[1].label', self.commandRouter.getI18nString('PLAYBACK_OPTIONS.MIXER_CONTROL_NAME'));

      if (activemixer_type === 'Hardware') {
        if ((typeof mixers !== 'undefined') || (mixers != null) || (mixers.length > 0)) {
          self.configManager.pushUIConfigParam(uiconf, 'sections[3].saveButton.data', 'mixer');
          if (activemixer) {
            self.configManager.setUIConfigParam(uiconf, 'sections[3].content[1].value', {
              value: activemixer,
              label: activemixer
            });
          } else {
            self.configManager.setUIConfigParam(uiconf, 'sections[3].content[1].value', {
              value: mixers[0],
              label: mixers[0]
            });
          }
          var index = mixers.indexOf('SoftMaster');
          if (index > -1) {
            mixers.splice(index, 1);
          }
          for (var i in mixers) {
            self.configManager.pushUIConfigParam(uiconf, 'sections[3].content[1].options', {
              value: mixers[i],
              label: mixers[i]
            });
          }
        }
      } else if (activemixer_type === 'Software') {
        self.configManager.setUIConfigParam(uiconf, 'sections[3].content[1].value', {
          value: 'SoftMaster',
          label: self.commandRouter.getI18nString('PLAYBACK_OPTIONS.SOFTVOL')
        });
        self.configManager.pushUIConfigParam(uiconf, 'sections[3].content[1].options', {
          value: 'SoftMaster',
          label: self.commandRouter.getI18nString('PLAYBACK_OPTIONS.SOFTVOL')
        });
      } else if (activemixer_type === 'None') {
        self.configManager.setUIConfigParam(uiconf, 'sections[3].content[1].value', {
          value: 'None',
          label: self.commandRouter.getI18nString('COMMON.NONE')
        });
        self.configManager.pushUIConfigParam(uiconf, 'sections[3].content[1].options', {
          value: 'None',
          label: self.commandRouter.getI18nString('COMMON.NONE')
        });
      }

      if (overrideMixerType !== undefined) {
          uiconf.sections[3].content[0].hidden = true;
          uiconf.sections[3].content[1].hidden = true;
          uiconf.sections[3].content[1].visibleIf = true;
      }

      value = self.getAdditionalConf('music_service', 'mpd', 'dop', false);
      if (volumioDeviceName === 'primo' && outdevicename === 'Analog RCA Output') {
        value = true;
        uiconf.sections[2].content[0].hidden = true;
      }
      self.configManager.setUIConfigParam(uiconf, 'sections[2].content[0].value.value', value);
      self.configManager.setUIConfigParam(uiconf, 'sections[2].content[0].value.label', self.getLabelForSelect(self.configManager.getValue(uiconf, 'sections[2].content[0].options'), value));

      value = self.getAdditionalConf('music_service', 'mpd', 'dsd_autovolume', false);
      self.configManager.setUIConfigParam(uiconf, 'sections[2].content[1].value', value);
      self.configManager.setUIConfigParam(uiconf, 'sections[2].content[1].value.label', self.getLabelForSelect(self.configManager.getValue(uiconf, 'sections[2].content[1].options'), value));

      value = self.getAdditionalConf('music_service', 'mpd', 'volume_normalization');
      self.configManager.setUIConfigParam(uiconf, 'sections[2].content[2].value', value);
      self.configManager.setUIConfigParam(uiconf, 'sections[2].content[2].value.label', self.getLabelForSelect(self.configManager.getValue(uiconf, 'sections[2].content[2].options'), value));

      value = self.getAdditionalConf('music_service', 'mpd', 'audio_buffer_size');
      self.configManager.setUIConfigParam(uiconf, 'sections[2].content[3].value.value', value);
      self.configManager.setUIConfigParam(uiconf, 'sections[2].content[3].value.label', self.getLabelForSelect(self.configManager.getValue(uiconf, 'sections[2].content[3].options'), value));

      value = self.getAdditionalConf('music_service', 'mpd', 'buffer_before_play');
      self.configManager.setUIConfigParam(uiconf, 'sections[2].content[4].value.value', value);
      self.configManager.setUIConfigParam(uiconf, 'sections[2].content[4].value.label', self.getLabelForSelect(self.configManager.getValue(uiconf, 'sections[2].content[4].options'), value));

      value = self.getAdditionalConf('music_service', 'mpd', 'persistent_queue', true);
      self.configManager.setUIConfigParam(uiconf, 'sections[2].content[5].value', value);
      self.configManager.setUIConfigParam(uiconf, 'sections[2].content[5].value.label', self.getLabelForSelect(self.configManager.getValue(uiconf, 'sections[2].content[5].options'), value));

      value = self.getAdditionalConf('music_service', 'mpd', 'iso', false);
      self.configManager.setUIConfigParam(uiconf, 'sections[2].content[6].value', value);
      self.configManager.setUIConfigParam(uiconf, 'sections[2].content[6].value.label', self.getLabelForSelect(self.configManager.getValue(uiconf, 'sections[2].content[6].options'), value));

      value = self.commandRouter.executeOnPlugin('music_service', 'mpd', 'getPlaybackMode');
      self.configManager.setUIConfigParam(uiconf, 'sections[2].content[7].value.value', value);
      self.configManager.setUIConfigParam(uiconf, 'sections[2].content[7].value.label', self.getLabelForSelect(self.configManager.getValue(uiconf, 'sections[2].content[7].options'), value));

      value = self.config.get('volumestart');
      self.configManager.setUIConfigParam(uiconf, 'sections[3].content[2].value.value', value);
      self.configManager.setUIConfigParam(uiconf, 'sections[3].content[2].value.label', self.getLabelForSelect(self.configManager.getValue(uiconf, 'sections[3].content[2].options'), value));

      value = self.config.get('volumemax');
      self.configManager.setUIConfigParam(uiconf, 'sections[3].content[3].value.value', value);
      self.configManager.setUIConfigParam(uiconf, 'sections[3].content[3].value.label', self.getLabelForSelect(self.configManager.getValue(uiconf, 'sections[3].content[3].options'), value));

      value = self.config.get('volumesteps');
      self.configManager.setUIConfigParam(uiconf, 'sections[3].content[4].value.value', value);
      self.configManager.setUIConfigParam(uiconf, 'sections[3].content[4].value.label', self.getLabelForSelect(self.configManager.getValue(uiconf, 'sections[3].content[4].options'), value));

      value = self.config.get('volumecurvemode');
      self.configManager.setUIConfigParam(uiconf, 'sections[3].content[5].value.value', value);
      self.configManager.setUIConfigParam(uiconf, 'sections[3].content[5].value.label', self.getLabelForSelect(self.configManager.getValue(uiconf, 'sections[3].content[5].options'), value));

      value = self.config.get('mpdvolume', false);
      self.configManager.setUIConfigParam(uiconf, 'sections[3].content[6].value', value);
      self.configManager.setUIConfigParam(uiconf, 'sections[3].content[6].value.label', self.getLabelForSelect(self.configManager.getValue(uiconf, 'sections[3].content[6].options'), value));

      value = self.config.get('resampling', false);
      self.configManager.setUIConfigParam(uiconf, 'sections[4].content[0].value', value);
      self.configManager.setUIConfigParam(uiconf, 'sections[4].content[0].value.label', self.getLabelForSelect(self.configManager.getValue(uiconf, 'sections[4].content[0].options'), value));

      value = self.config.get('resampling_target_bitdepth', '*');
      self.configManager.setUIConfigParam(uiconf, 'sections[4].content[1].value.value', value);
      self.configManager.setUIConfigParam(uiconf, 'sections[4].content[1].value.label', self.getLabelForSelect(self.configManager.getValue(uiconf, 'sections[4].content[1].options'), value));

      value = self.config.get('resampling_target_samplerate', '*');
      self.configManager.setUIConfigParam(uiconf, 'sections[4].content[2].value.value', value);
      self.configManager.setUIConfigParam(uiconf, 'sections[4].content[2].value.label', self.getLabelForSelect(self.configManager.getValue(uiconf, 'sections[4].content[2].options'), value));

      value = self.config.get('resampling_quality', 'high');
      self.configManager.setUIConfigParam(uiconf, 'sections[4].content[3].value.value', value);
      self.configManager.setUIConfigParam(uiconf, 'sections[4].content[3].value.label', self.getLabelForSelect(self.configManager.getValue(uiconf, 'sections[4].content[3].options'), value));

      var payload = {'number': cardnum, 'name': outdevicename};

      var dspoptions = self.getDSPDACOptions(payload);
      if (dspoptions && dspoptions.length > 0) {
        self.configManager.setUIConfigParam(uiconf, 'sections[1].label', outdevicename + ' ' + self.commandRouter.getI18nString('PLAYBACK_OPTIONS.ADVANCED_DAC_DSP_OPTIONS'));
        self.configManager.setUIConfigParam(uiconf, 'sections[1].hidden', false);
        for (var w = 0; w < dspoptions.length; w++) {
          self.configManager.pushUIConfigParam(uiconf, 'sections[1].saveButton.data', dspoptions[w].name);
          var dspconf = {id: dspoptions[w].name, element: 'select', label: dspoptions[w].name, hidden: false, value: {value: dspoptions[w].value, label: dspoptions[w].value}, options: []};
          self.configManager.pushUIConfigParam(uiconf, 'sections[1].content', dspconf);

          if ((dspoptions[w].name === 'Subwoofer mode') && (dspoptions[w].value === 'None')) {
            uiconf.sections[1].content[1].hidden = true;
          }

          for (var r in dspoptions[w].options) {
            self.configManager.pushUIConfigParam(uiconf, 'sections[1].content[' + w + '].options', {
              value: dspoptions[w].options[r],
              label: dspoptions[w].options[r]
            });
          }
        }
      }

      var advancedSettingsStatus = self.commandRouter.getAdvancedSettingsStatus();
      if (advancedSettingsStatus === false) {
        uiconf.sections[2].hidden = true;
        uiconf.sections[3].content[4].hidden = true;
        uiconf.sections[3].content[5].hidden = true;
        uiconf.sections[3].content[6].hidden = true;
        uiconf.sections[4].hidden = true;
      }

      var additionalConfs = self.getAdditionalUISections();
      additionalConfs.then((conf) => {
            	for (var i in conf) {
            		var additionalConf = conf[i];
            		if (additionalConf && additionalConf.section && additionalConf.position) {
            uiconf.sections.splice(additionalConf.position, 0, additionalConf.section);
          }
        }
            	defer.resolve(uiconf);
      })
        .fail(() => {
            	defer.resolve(uiconf);
        });
    })
    .fail(function (e) {
      self.logger.error('Error retrieving UIConf: ' + e);
      defer.reject(new Error());
    });

  return defer.promise;
};

ControllerAlsa.prototype.getAdditionalUISections = function () {
  var self = this;
  var defer = libQ.defer();

  var uiSectionsDefer = [];

  if (additionalUISections.length) {
    	for (var i in additionalUISections) {
    		var section = additionalUISections[i];
    		var pluginType = section.split('/')[0];
    		var pluginName = section.split('/')[1];
      var additionalUISection = self.commandRouter.executeOnPlugin(pluginType, pluginName, 'getAdditionalUiSection');
      uiSectionsDefer.push(additionalUISection);
    	}
    libQ.all(uiSectionsDefer).then((uiSectionsResult) => {
      defer.resolve(uiSectionsResult);
    	})
      .fail(() => {
        defer.resolve({});
    	});
  } else {
    	defer.resolve({});
  }

  return defer.promise;
};

ControllerAlsa.prototype.addAdditionalUISections = function (data) {
  var self = this;

  // Add additional UI Sections, must be = type/plugin
  if (data) {
    	if (additionalUISections && additionalUISections.indexOf(data) === -1) {
    		self.logger.info('Additional UI Settings Added for plugin ' + data);
    		additionalUISections.push(data);
    }
  }
};

ControllerAlsa.prototype.saveDSPOptions = function (data) {
  var self = this;
  var defer = libQ.defer();
  var reboot = false;

  var value = self.config.get('outputdevice');
  if (value == undefined) {
    value = 0;
  } else if (value == 'softvolume') {
    value = self.config.get('softvolumenumber');
  }

  var outdevicename = self.config.get('outputdevicename');
  if (outdevicename) {
  } else {
    var cards = self.getAlsaCards();
    outdevicename = self.getLabelForSelectedCard(cards, value);
  }
  if (outdevicename == 'Allo Piano 2.1') {
    var SubValue = execSync("amixer get -c " + value + " 'Subwoofer mode' | grep Item0", {encoding: 'utf8'}).split("'")[1];
    var DualModeValue = execSync("amixer get -c " + value + " 'Dual Mode' | grep Item0", {encoding: 'utf8'}).split("'")[1];

    if (data['Dual Mode'].value != DualModeValue && data['Dual Mode'].value != 'None') {
      data['Subwoofer mode'].value = 'None';
      reboot = true;
    } else if (data['Subwoofer mode'].value != SubValue && data['Subwoofer mode'].value != 'None') {
      data['Dual Mode'].value = 'None';
      reboot = true;
    }
  }

  for (var i in data) {
    var dspname = i;
    var dspvalue = data[i].value;

    try {
      execSync('/usr/bin/amixer -c ' + value + ' set "' + dspname + '" "' + dspvalue + '"', {uid: 1000, gid: 1000, encoding: 'utf8'});
      self.logger.info('Successfully set DSP ' + dspname + ' with value ' + dspvalue + ' for card ' + value);
    } catch (e) {
      self.logger.info('ERROR Cannot set DSP ' + dspname + ' for card ' + value + ': ' + error);
    }
  }

  if (reboot) {
    var responseData = {
      title: self.commandRouter.getI18nString('PLAYBACK_OPTIONS.DSP_PROGRAM_ENABLED'),
      message: self.commandRouter.getI18nString('PLAYBACK_OPTIONS.DSP_PROGRAM_REBOOT'),
      size: 'lg',
      buttons: [
        {
          name: self.commandRouter.getI18nString('COMMON.RESTART'),
          class: 'btn btn-info',
          emit: 'reboot',
          payload: ''
        }
      ]
    };

    self.commandRouter.broadcastMessage('openModal', responseData);
  }

  self.commandRouter.pushToastMessage('success', self.commandRouter.getI18nString('PLAYBACK_OPTIONS.ADVANCED_DAC_DSP_OPTIONS'), self.commandRouter.getI18nString('PLAYBACK_OPTIONS.DSP_PROGRAM_ENABLED'));

  var respconfig = self.commandRouter.getUIConfigOnPlugin('audio_interface', 'alsa_controller', {});

  respconfig.then(function (config) {
    self.commandRouter.broadcastMessage('pushUiConfig', config);
  });

  return defer.promise;
};

ControllerAlsa.prototype.getDSPDACOptions = function (data) {
  var self = this;

  var dspdata = fs.readJsonSync(('/volumio/app/plugins/audio_interface/alsa_controller/dac_dsp.json'), 'utf8', {throws: false});
  var dspobject = {};
  var dspcontrols = [];

  for (var e = 0; e < dspdata.cards.length; e++) {
    if (dspdata.cards[e].name === data.name) {
      try {
        var dsparray = execSync('amixer -c ' + data.number + ' scontents', {encoding: 'utf8'});
        var dspobj = dsparray.toString().split('Simple mixer control');

        for (var i in dspobj) {
          if (dspobj[i].indexOf('Items') >= 0) {
            var line = dspobj[i].split('\n');
            // console.log(line)
            var line2 = line[0].split(',');
            var dspspace = line2[0].replace(/'/g, '').toString();
            var dspname = dspspace.replace(' ', '');
            if (dspdata.cards[e].dsp_options.indexOf(dspname) > -1) {
              // console.log('1'+dspname)
              // console.log(line[2])
              var dspoptsarray = line[2].replace(/Items:/g, '').replace(' ', '').split("'").filter(function (val) {
                return val.length > 0 && val != ' ' && val != '  ';
              });

              // console.log('2'+dspoptsarray)
              var dspvalue = line[3].replace(/Item0:/g, '').replace(' ', '').replace(/\'/g, '').replace(/\s+/, '');
              // console.log('--'+dspvalue+'--')
              dspcontrols.push({'name': dspname, 'options': dspoptsarray, 'value': dspvalue});
            }
          }
        }
      } catch (e) {

      }
    }
  }
  return dspcontrols;
};

ControllerAlsa.prototype.saveAlsaOptions = function (data) {
  var self = this;
  var defer = libQ.defer();
  var uiPush = true;

  //console.log('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' + JSON.stringify(data));
  if (data.output_device.label != undefined) {
    data.output_device.label = data.output_device.label.replace('USB: ', '');
  }

  if (data.disallowPush != undefined && data.disallowPush) {
    uiPush = false;
  }

  var i2sstatus = self.commandRouter.executeOnPlugin('system_controller', 'i2s_dacs', 'getI2sStatus');

  var OutputDeviceNumber = data.output_device.value;

  if (data.i2s) {
    var I2SNumber = self.commandRouter.executeOnPlugin('system_controller', 'i2s_dacs', 'getI2SNumber', data.i2sid.label);
    if (i2sstatus.name != data.i2sid.label) {
      self.logger.info('Enabling I2S DAC: ' + data.i2sid.label);
      var response = self.commandRouter.executeOnPlugin('system_controller', 'i2s_dacs', 'enableI2SDAC', data.i2sid.label);
      if (response != undefined) {
        response.then(function (result) {
          if (result.reboot == 'yes') {
            var responseData = {
              title: self.commandRouter.getI18nString('PLAYBACK_OPTIONS.I2S_DAC_ACTIVATED'),
              message: data.i2sid.label + ' ' + self.commandRouter.getI18nString('PLAYBACK_OPTIONS.I2S_DAC_ACTIVATED_MESSAGE'),
              size: 'lg',
              buttons: [
                {
                  name: self.commandRouter.getI18nString('COMMON.RESTART'),
                  class: 'btn btn-info',
                  emit: 'reboot',
                  payload: ''
                }
              ]
            };
            if (uiPush) {
              self.commandRouter.broadcastMessage('openModal', responseData);
            }
            self.commandRouter.executeOnPlugin('miscellanea', 'wizard', 'setWizardAction', {'action': 'reboot', 'dacName': data.i2sid.label});
          }
        })
          .fail(function () {
            self.logger.log('Error Setting i2s DAC');
          });
      }
      this.config.set('outputdevicename', data.i2sid.label);
      OutputDeviceNumber = I2SNumber;
    }
  } else {
    if (data.output_device.label === 'HDMI Out') {
      if (this.config.has('outputdevicename') == false) {
        this.config.addConfigValue('outputdevicename', 'string', 'HDMI Out');
      } else {
        this.config.set('outputdevicename', 'HDMI Out');
      }
      self.enablePiHDMI();
    } else if (data.output_device.label === 'Audio Jack') {
      if (this.config.has('outputdevicename') == false) {
        this.config.addConfigValue('outputdevicename', 'string', 'Audio Jack');
      } else {
        this.config.set('outputdevicename', 'Audio Jack');
      }
      self.enablePiJack();
    } else {
      if (this.config.has('outputdevicename') == false) {
        this.config.addConfigValue('outputdevicename', 'string', data.output_device.label);
      } else {
        this.config.set('outputdevicename', data.output_device.label);
      }
    }

    if (i2sstatus.enabled) {
      self.logger.info('Disabling I2S DAC: ');
      self.commandRouter.executeOnPlugin('system_controller', 'i2s_dacs', 'disableI2SDAC', '');

      /*
			var responseData = {
				title: self.commandRouter.getI18nString('PLAYBACK_OPTIONS.I2S_DAC_DEACTIVATED'),
				message: data.i2sid.label+ ' ' + self.commandRouter.getI18nString('PLAYBACK_OPTIONS.I2S_DAC_DEACTIVATED_MESSAGE'),
				size: 'lg',
				buttons: [
					{
						name: self.commandRouter.getI18nString('COMMON.RESTART'),
						class: 'btn btn-info',
						emit:'reboot',
						payload:''
					}
				]
			}

			self.commandRouter.broadcastMessage("openModal", responseData);
			 */
    }
  }

  self.commandRouter.sharedVars.set('alsa.outputdevice', OutputDeviceNumber);
  self.setDefaultMixer(OutputDeviceNumber);

  var respconfig = self.commandRouter.getUIConfigOnPlugin('audio_interface', 'alsa_controller', {});

  respconfig.then(function (config) {
    if (uiPush) {
      self.commandRouter.broadcastMessage('pushUiConfig', config);
    }
  });

  return defer.promise;
};

ControllerAlsa.prototype.saveVolumeOptions = function (data) {
  var self = this;

  var defer = libQ.defer();

  self.setConfigParam({key: 'volumestart', value: data.volumestart.value});
  self.setConfigParam({key: 'volumemax', value: data.volumemax.value});
  self.setConfigParam({key: 'volumecurvemode', value: data.volumecurvemode.value});
  self.setConfigParam({key: 'volumesteps', value: data.volumesteps.value});
  var currentState = self.commandRouter.volumioGetState();
  if (currentState && currentState.volume !== undefined && currentState.mute !== undefined) {
    var currentVolume = currentState.volume;
    var currentMute = currentState.mute;
  }

  var mpdvalue = self.config.get('mpdvolume', false);
  if (mpdvalue != data.mpdvolume) {
    self.setConfigParam({key: 'mpdvolume', value: data.mpdvolume});
    self.commandRouter.executeOnPlugin('music_service', 'mpd', 'saveResampleOptions', '');
  }

  if (data.mixer_type.value === 'Hardware') {
    if (data.mixer.value == 'SoftMaster' || data.mixer.value == 'None') {
      var value = self.config.get('outputdevice');
      if (value == undefined) {
        value = 0;
      } else if (value == 'softvolume') {
        value = self.config.get('softvolumenumber');
      }
      var mixers = self.getMixerControls(value);
      var index = mixers.indexOf('SoftMaster');
      if (index > -1) {
        mixers.splice(index, 1);
      }
      data.mixer.value = mixers[0];
    }
    var outValue = self.config.get('outputdevice', 'none');
    if (outValue === 'softvolume') {
      var currentDeviceNumber = self.config.get('softvolumenumber', 'none');
      self.disableSoftMixer(currentDeviceNumber);
      self.config.set('outputdevice', currentDeviceNumber);
      self.config.delete('softvolumenumber');
      self.commandRouter.sharedVars.set('alsa.outputdevice', currentDeviceNumber);
    }
    self.restorePreviousVolumeLevel(currentVolume, currentMute, false);
    self.setConfigParam({key: 'mixer', value: data.mixer.value});
  } else if (data.mixer_type.value === 'Software') {
    var outdevice = self.config.get('outputdevice');
    if (outdevice != 'softvolume') {
      self.restorePreviousVolumeLevel(currentVolume, currentMute, true);
      self.enableSoftMixer(outdevice);
      var outdevice = 'softvolume';
      self.config.set('outputdevice', outdevice);
      self.commandRouter.sharedVars.set('alsa.outputdevice', outdevice);
    } else {
      self.restorePreviousVolumeLevel(currentVolume, currentMute, true);
    }
  } else if (data.mixer_type.value === 'None') {
    self.setConfigParam({key: 'mixer', value: ''});
    var outdevice = self.config.get('outputdevice');
    self.setConfigParam({key: 'volumemax', value: '100'});
    self.restorePreviousVolumeLevel('100', false, false);
    if (outdevice === 'softvolume') {
      var outdevice = self.config.get('softvolumenumber');
      this.config.set('outputdevice', outdevice);
      self.config.delete('softvolumenumber');
      self.restartMpd.bind(self);
      self.disableSoftMixer(outdevice);
    }
    self.commandRouter.sharedVars.set('alsa.outputdevice', outdevice);
  }
  self.setConfigParam({key: 'mixer_type', value: data.mixer_type.value});

  self.logger.info('Volume configurations have been set');
  self.commandRouter.sharedVars.set('alsa.outputdevicemixer', data.mixer.value);

  self.commandRouter.pushToastMessage('success', self.commandRouter.getI18nString('PLAYBACK_OPTIONS.MIXER_CONTROLS'), self.commandRouter.getI18nString('PLAYBACK_OPTIONS.MIXER_CONTROLS_UPDATE'));

  defer.resolve({});
  this.updateVolumeSettings();

  var respconfig = self.commandRouter.getUIConfigOnPlugin('audio_interface', 'alsa_controller', {});

  respconfig.then(function (config) {
    self.commandRouter.broadcastMessage('pushUiConfig', config);
  });

  return defer.promise;
};

ControllerAlsa.prototype.saveResamplingOpts = function (data) {
  var self = this;

  var defer = libQ.defer();
  self.commandRouter.executeOnPlugin('music_service', 'mpd', 'saveResampleOptions', data);

  self.setConfigParam({key: 'resampling', value: data.resampling});
  self.setConfigParam({key: 'resampling_target_bitdepth', value: data.resampling_target_bitdepth.value});
  self.setConfigParam({key: 'resampling_target_samplerate', value: data.resampling_target_samplerate.value});
  self.setConfigParam({key: 'resampling_quality', value: data.resampling_quality.value});

  self.commandRouter.pushToastMessage('success', self.commandRouter.getI18nString('PLAYBACK_OPTIONS.AUDIO_RESAMPLING'), self.commandRouter.getI18nString('PLAYBACK_OPTIONS.AUDIO_RESAMPLING_SETTINGS_SAVED'));

  defer.resolve({});

  return defer.promise;
};

ControllerAlsa.prototype.outputDeviceCallback = function (value) {
  this.config.set('outputdevice', value);
};

ControllerAlsa.prototype.getConfigParam = function (key) {
  return this.config.get(key);
};

ControllerAlsa.prototype.setConfigParam = function (data) {
  this.config.set(data.key, data.value);
};

ControllerAlsa.prototype.getConfigurationFiles = function () {
  return ['config.json'];
};

ControllerAlsa.prototype.getAdditionalConf = function (type, controller, data, def) {
  var self = this;
  var setting = self.commandRouter.executeOnPlugin(type, controller, 'getConfigParam', data);

  if (setting == undefined) {
    setting = def;
  }
  return setting;
};

ControllerAlsa.prototype.setAdditionalConf = function (type, controller, data) {
  var self = this;
  return self.commandRouter.executeOnPlugin(type, controller, 'setConfigParam', data);
};

ControllerAlsa.prototype.getLabelForSelectedCard = function (cards, key) {
  var self = this;
  var n = cards.length;
  for (var i = 0; i < n; i++) {
    if (cards[i].id == key) { return cards[i].name; }
  }

  return self.commandRouter.getI18nString('PLAYBACK_OPTIONS.NO_AUDIO_DEVICE_AVAILABLE');
};

ControllerAlsa.prototype.getLabelForSelect = function (options, key) {
  var self = this;
  var n = options.length;
  for (var i = 0; i < n; i++) {
    if (options[i].value == key) { return options[i].label; }
  }

  return 'Error';
};

ControllerAlsa.prototype.getAlsaCards = function () {
  var self = this;
  var multi = false;
  var cards = [];
  var carddata = fs.readJsonSync(('/volumio/app/plugins/audio_interface/alsa_controller/cards.json'), 'utf8', {throws: false});

  try {
    var ignoredCards = fs.readJsonSync(('/volumio/app/plugins/audio_interface/alsa_controller/ignoreCards.json'), 'utf8', {throws: false});
  } catch (e) {
    var ignoredCards = [];
  }

  try {
    var aplaycards = self.getAplayInfo();
    for (var k = 0; k < aplaycards.length; k++) {
      var aplaycard = aplaycards[k];
      var name = aplaycard.name;
      var id = aplaycard.id;
        	if (!ignoredCards.includes(name)) {
        for (var n = 0; n < carddata.cards.length; n++) {
          var ignore = false;
          var cardname = carddata.cards[n].name.toString().trim();
          if (cardname === name) {
            if (carddata.cards[n].multidevice) {
              multi = true;
              var card = carddata.cards[n];
              for (var j = 0; j < card.devices.length; j++) {
                            	var currentCard = carddata.cards[n].devices[j];
                var subdevice = Number(currentCard.number);
                name = currentCard.prettyname;
                if (volumioDeviceName === 'primo') {
                  if (name === 'Audio Jack Out' || name === 'HDMI') {
                    currentCard.ignore = true;
                  }
                }
                var deviceProc = '/proc/asound/card' + id + '/pcm' + (subdevice).toString() + 'p';
                if (fs.existsSync(deviceProc)) {
                                	if (!currentCard.ignore) {
                    if (currentCard.default !== undefined && currentCard.default) {
                      cards.unshift({id: id + ',' + subdevice, name: name});
                      name = undefined;
                    } else {
                      cards.push({id: id + ',' + subdevice, name: name});
                      name = undefined;
                    }
                  } else {
                    name = undefined;
                  }
                }
              }
            } else {
              multi = false;
              name = carddata.cards[n].prettyname;
            }
          } else {
            multi = false;
          }
        } if (!multi && name !== undefined) {
          if (volumioDeviceName === 'primo') {
            if (name === 'ES90x8Q2M DAC') {
              name = 'Analog RCA Output';
            }
          }
          cards.push({id: id, name: name});
        }
      }
    }
    if (volumioDeviceName === 'primo') {
        	// Not necessary anymore since we ignore HDMI
      // cards.unshift(cards[2]);
      // cards.splice(3, 1);
    }
  } catch (e) {
    var namestring = self.commandRouter.getI18nString('PLAYBACK_OPTIONS.NO_AUDIO_DEVICE_AVAILABLE');
    cards.push({id: '', name: namestring});
  }
  return cards;
};

ControllerAlsa.prototype.getAplayInfo = function () {
  var self = this;
  var defer = libQ.defer();
  var cards = [];
  var namesArray = [];
  try {
    var aplaycmd = execSync('/usr/bin/aplay -l', {uid: 1000, gid: 1000, encoding: 'utf8'});
    var currentCard;
    var line = aplaycmd.split('\n');
    for (var i = 0; i < line.length; i++) {
      if (line[i].indexOf('card') >= 0) {
        var info = line[i].split(',')[0];
        var num = info.split(':')[0].replace('card ', '');
        var name = info.split('[')[1].replace(']', '');
        var card = {'id': num, 'name': name};
        if (num != currentCard) {
          cards.push(card);
        }
        namesArray.push(name);
        currentCard = num;
      }
    }
    if ((namesArray.includes('TinkerAudio OnBoard') || namesArray.includes('USB Audio OnBoard')) && namesArray.includes('ES90x8Q2M DAC')) {
            	try {
        var sysVariant = execSync("cat /etc/os-release | grep ^VOLUMIO_VARIANT | tr -d 'VOLUMIO_VARIANT=\"'").toString().replace('\n', '');
      } catch (e) {
            		self.logger.error('Could not read volumio variant: ' + e);
      }
      if (sysVariant === 'volumio' || sysVariant === 'primo') {
        if (self.commandRouter.sharedVars.get('device_vendor_model') !== 'Volumio Primo') {
          self.commandRouter.sharedVars.addConfigValue('device_vendor_model', 'string', 'Volumio Primo');
          self.commandRouter.sharedVars.set('device_vendor_model', 'Volumio Primo');
        }
            				volumioDeviceName = 'primo';
      }
    }
  } catch (e) {
    console.log('Cannot get aplay -l output: ' + e);
    return cards;
  }
  return cards;
};

ControllerAlsa.prototype.getMixerControls = function (device) {
  var self = this;

  var mixers = [];
  var outdev = this.config.get('outputdevice');
  if (outdev == 'softvolume') {
    outdev = this.config.get('softvolumenumber');
  }
  if (outdev.indexOf(',') >= 0) {
    outdev = outdev.charAt(0);
  }
  try {
    var array = execSync('amixer -c ' + outdev + ' scontents', { encoding: 'utf8' });
    var genmixers = array.toString().split('Simple mixer control');

    for (var i in genmixers) {
      if (genmixers[i].indexOf('Playback') >= 0) {
        var line = genmixers[i].split('\n');
        var line2 = line[0].split(',');
        var mixerspace = line2[0].replace(/'/g, '').toString();
        var mixer = mixerspace.replace(' ', '');
        for (var i in mixers) {
          if (mixers[i] == mixer) {
            mixer = mixer + ',1';
          }
        }
        if (self.checkValidMixer(mixer)) {
          mixers.push(mixer);
        }
      }
    }
  } catch (e) {}

  if (volumioDeviceName === 'primo' && device === '1,1') {
    mixers = [];
  }

  return mixers;
};

ControllerAlsa.prototype.setDefaultMixer = function (device) {
  var self = this;

  var mixers = [];
  var currentcardname = '';
  var defaultmixer = '';
  var match = '';
  var mixertpye = '';
  var carddata = fs.readJsonSync(('/volumio/app/plugins/audio_interface/alsa_controller/cards.json'), 'utf8', {throws: false});
  var cards = self.getAlsaCards();
  var outputdevice = self.config.get('outputdevice');
  var ignoreGenMixers = false;

  var i2sstatus = self.commandRouter.executeOnPlugin('system_controller', 'i2s_dacs', 'getI2sStatus');

  for (var i in cards) {
    var devnum = device.toString();
    if (devnum == cards[i].id) {
      currentcardname = cards[i].name;
    }
  }

  if (outputdevice === 'Loopback') {
      self.logger.info('Output is Loopback, do not update Mixer');
      return;
  }

  if (i2sstatus && i2sstatus.enabled) {
    var cardname = i2sstatus.name;
    var mixer = self.commandRouter.executeOnPlugin('system_controller', 'i2s_dacs', 'getI2SMixer', cardname);
    if (mixer) {
      defaultmixer = mixer;
      self.logger.info('Found match in i2s Card Database: setting mixer ' + defaultmixer + ' for card ' + cardname);
    }
  } else {
    for (var n = 0; n < carddata.cards.length; n++) {
      if (carddata.cards[n].multidevice) {
        for (var j = 0; j < carddata.cards[n].devices.length; j++) {
          var cardname = carddata.cards[n].devices[j].prettyname.toString().trim();

          if (cardname == currentcardname) {
            defaultmixer = carddata.cards[n].devices[j].defaultmixer;
            self.logger.info('Found match in Cards Database: setting mixer ' + defaultmixer + ' for card ' + currentcardname);
          }
        }
      } else {
        var cardname = carddata.cards[n].prettyname.toString().trim();
        if (cardname == currentcardname) {
          defaultmixer = carddata.cards[n].defaultmixer;
          self.logger.info('Found match in Cards Database: setting mixer ' + defaultmixer + ' for card ' + currentcardname);
          self.commandRouter.sharedVars.set('alsa.outputdevicemixer', defaultmixer);
        }
      }
    }
  }
  if (volumioDeviceName === 'primo' && device === '1,1') {
    defaultmixer = '';
  }

  if (defaultmixer) {
    this.mixertype = 'Hardware';
  } else {
    try {
      if (volumioDeviceName === 'primo' && device === '1,1') {
        ignoreGenMixers = true;
      }
      if (device.indexOf(',') >= 0) {
            	device = device.charAt(0);
      }
      var array = execSync('amixer -c ' + device + ' scontents', { encoding: 'utf8' });
      var genmixers = array.toString().split('Simple mixer control');

      if (genmixers) {
        for (var i in genmixers) {
          if (genmixers[i].indexOf('Playback') >= 0) {
            var line = genmixers[i].split('\n');
            var line2 = line[0].split(',');
            var mixerspace = line2[0].replace(/'/g, '');
            var mixer = mixerspace.replace(' ', '');
            if (self.checkValidMixer(mixer)) {
              mixers.push(mixer);
            }
          }
        }
        if (outputdevice === 'softvolume') {
          self.logger.info('Setting default mixerSoftMaster for Softvolume device');
          this.mixertype = 'Software';
          defaultmixer = 'SoftMaster';
          self.commandRouter.sharedVars.set('alsa.outputdevicemixer', defaultmixer);
        } else {
          if (mixers[0] && mixers[0] != 'SoftMaster') {
            defaultmixer = mixers[0].toString();
            self.logger.info('Setting mixer ' + defaultmixer + ' for card ' + currentcardname);
            this.mixertype = 'Hardware';
            self.commandRouter.sharedVars.set('alsa.outputdevicemixer', defaultmixer);
          } else {
            self.logger.info('Device ' + device + ' does not have any Mixer Control Available, setting a softvol device');
            this.mixertype = 'None';
            self.commandRouter.sharedVars.set('alsa.outputdevicemixer', 'None');
            // defaultmixer = 'SoftMaster';
            // self.enableSoftMixer(device);
          }
        }
      }

      if (ignoreGenMixers) {
        self.logger.info('Ignoring Mixers Options');
        self.logger.info('Device ' + device + ' does not have any Mixer Control Available');
        this.mixertype = 'None';
        self.commandRouter.sharedVars.set('alsa.outputdevicemixer', 'None');
      }
    } catch (e) {}
  }
  if (this.config.has('mixer_type') == false) {
    this.config.addConfigValue('mixer_type', 'string', this.mixertype);
  } else {
    self.setConfigParam({key: 'mixer_type', value: this.mixertype});
  }
  if (this.config.has('mixer') == false) {
    this.config.addConfigValue('mixer', 'string', defaultmixer);
    this.updateVolumeSettings();
  } else {
    self.setConfigParam({key: 'mixer', value: defaultmixer});
    this.updateVolumeSettings();
  }
  setTimeout(() => {
    self.commandRouter.retrieveVolumeLevels();
  }, 2500);
};

ControllerAlsa.prototype.checkMixer = function () {
  var self = this;

  var mixer_tpye = self.config.get('mixer_type');
  var outputdevice = self.config.get('outputdevice');

  if (mixer_tpye === 'Hardware') {
    var mixers = self.getMixerControls(outputdevice);

    if (mixers.length > 0) {
      if (mixers[0] === 'SoftMaster') {
        self.logger.info('Hardware Mixer mismatch, hardware mixer type but softmixer selected, correcting ');
        self.setConfigParam({key: 'mixer_type', value: 'Software'});
        self.setConfigParam({key: 'mixer', value: 'SoftMaster'});
        self.setConfigParam({key: 'mixer_type', value: 'Software'});
        if (this.config.has('softvolumenumber') == false) {
          self.config.addConfigValue('softvolumenumber', 'string', outputdevice);
        } else {
          self.setConfigParam({key: 'softvolumenumber', value: outputdevice});
        }
        self.commandRouter.sharedVars.set('alsa.outputdevicemixer', 'SoftMaster');
        self.commandRouter.sharedVars.set('alsa.outputdevice', 'softvolume');
        self.updateVolumeSettings();
        // Restarting MPD, this seems needed only on first boot
        setTimeout(function () {
          self.commandRouter.executeOnPlugin('music_service', 'mpd', 'restartMpd', '');
        }, 1500);
      }
    } else {
      self.logger.info('Hardware Mixer selected but no Hardware mixer available, detecting default mixer');
      self.setDefaultMixer(outputdevice);
    }
  }
};

ControllerAlsa.prototype.enableSoftMixer = function (data) {
  var self = this;

  self.logger.info('Enable softmixer device for audio device number ' + data);

  self.writeSoftMixerFile(data)
    .then(self.setSoftParams.bind(self))
    .then(self.apply1.bind(self))
    .then(self.apply2.bind(self))
    .then(self.setSoftConf.bind(self))
    .then(self.setSoftVolConf.bind(self))
    .then(self.restartMpd.bind(self));
};
ControllerAlsa.prototype.writeSoftMixerFile = function (data) {
  var self = this;
  var defer = libQ.defer();

  self.logger.info('Enable softmixer device for audio device number ' + data);
  var outnum = data;
  self.commandRouter.volumioStop();
  if (this.config.has('softvolumenumber') == false) {
    self.config.addConfigValue('softvolumenumber', 'string', data);
    self.updateVolumeSettings();
  } else {
    self.setConfigParam({key: 'softvolumenumber', value: data});
  }

  var asoundcontent = '';
  if (data.indexOf(',') >= 0) {
    var dataarr = data.split(',');
    var card = dataarr[0];
    var device = dataarr[1];

    asoundcontent += 'pcm.softvolume {\n';
    asoundcontent += '    type             plug\n';
    asoundcontent += '    slave.pcm       "softvol"\n';
    asoundcontent += '}\n';
    asoundcontent += '\n';
    asoundcontent += 'pcm.softvol {\n';
    asoundcontent += '    type            softvol\n';
    asoundcontent += '    slave {\n';
    asoundcontent += '        pcm         "plughw:' + data + '"\n';
    asoundcontent += '    }\n';
    asoundcontent += '    control {\n';
    asoundcontent += '        name        "SoftMaster"\n';
    asoundcontent += '        card        ' + card + '\n';
    asoundcontent += '        device      ' + device + '\n';
    asoundcontent += '    }\n';
    asoundcontent += 'max_dB 0.0\n';
    asoundcontent += 'min_dB -50.0\n';
    asoundcontent += 'resolution 100\n';
    asoundcontent += '}\n';
  } else {
    asoundcontent += 'pcm.softvolume {\n';
    asoundcontent += '    type             plug\n';
    asoundcontent += '    slave.pcm       "softvol"\n';
    asoundcontent += '}\n';
    asoundcontent += '\n';
    asoundcontent += 'pcm.softvol {\n';
    asoundcontent += '    type            softvol\n';
    asoundcontent += '    slave {\n';
    asoundcontent += '        pcm         "plughw:' + data + ',0"\n';
    asoundcontent += '    }\n';
    asoundcontent += '    control {\n';
    asoundcontent += '        name        "SoftMaster"\n';
    asoundcontent += '        card        ' + data + '\n';
    asoundcontent += '        device      0\n';
    asoundcontent += '    }\n';
    asoundcontent += 'max_dB 0.0\n';
    asoundcontent += 'min_dB -50.0\n';
    asoundcontent += 'resolution 100\n';
    asoundcontent += '}\n';
  }

  fs.writeFile('/home/volumio/.asoundrc', asoundcontent, 'utf8', function (err) {
    if (err) {
      self.logger.info('Cannot write /etc/asound.conf: ' + err);
    } else {
      self.logger.info('Asound.conf file written');
      var mv = execSync('/usr/bin/sudo /bin/mv /home/volumio/.asoundrc /etc/asound.conf', { uid: 1000, gid: 1000, encoding: 'utf8' });
      var apply = execSync('/usr/sbin/alsactl -L -R nrestore', { uid: 1000, gid: 1000, encoding: 'utf8' });
      defer.resolve();
    }
  });

  return defer.promise;
};

ControllerAlsa.prototype.setSoftParams = function () {
  var self = this;
  var defer = libQ.defer();

  self.setConfigParam({key: 'mixer', value: 'SoftMaster'});
  self.setConfigParam({key: 'outputdevice', value: 'softvolume'});

  defer.resolve();
  return defer.promise;
};

ControllerAlsa.prototype.apply1 = function () {
  var self = this;
  var defer = libQ.defer();

  try {
    var apply2 = execSync('/usr/bin/aplay -D softvolume /volumio/app/silence.wav', { encoding: 'utf8' });
  } catch (e) {

  }

  defer.resolve();
  return defer.promise;
};

ControllerAlsa.prototype.apply2 = function () {
  var self = this;
  var defer = libQ.defer();

  var apply3 = execSync('/usr/sbin/alsactl -L -R nrestore', { uid: 1000, gid: 1000, encoding: 'utf8' });
  defer.resolve();
  return defer.promise;
};

ControllerAlsa.prototype.setSoftConf = function () {
  var self = this;
  var defer = libQ.defer();

  self.commandRouter.sharedVars.set('alsa.outputdevicemixer', 'SoftMaster');
  self.commandRouter.sharedVars.set('alsa.outputdevice', 'softvolume');

  defer.resolve();
  return defer.promise;
};

ControllerAlsa.prototype.setSoftVolConf = function () {
  var self = this;
  var defer = libQ.defer();

  self.updateVolumeSettings();
  defer.resolve();
  return defer.promise;
};

ControllerAlsa.prototype.restartMpd = function () {
  var self = this;
  var defer = libQ.defer();

  setTimeout(function () {
    self.commandRouter.executeOnPlugin('music_service', 'mpd', 'restartMpd', '');
    defer.resolve();
  }, 1500);

  return defer.promise;
};

ControllerAlsa.prototype.disableSoftMixer = function (data) {
  var self = this;

  self.logger.info('Disable softmixer device for audio device');

  var asoundcontent = '';

  fs.writeFile('/home/volumio/.asoundrc', asoundcontent, 'utf8', function (err) {
    if (err) {
      self.logger.info('Cannot write /etc/asound.conf: ' + err);
    } else {
      self.logger.info('Asound.conf file written');
      var mv = execSync('/usr/bin/sudo /bin/mv /home/volumio/.asoundrc /etc/asound.conf', { uid: 1000, gid: 1000, encoding: 'utf8' });
      var apply = execSync('/usr/sbin/alsactl -L -R nrestore', { uid: 1000, gid: 1000, encoding: 'utf8' });
      self.updateVolumeSettings();
      var apply3 = execSync('/usr/sbin/alsactl -L -R nrestore', { uid: 1000, gid: 1000, encoding: 'utf8' });
    }
  });
};

ControllerAlsa.prototype.updateVolumeSettings = function () {
  var self = this;

  var outdevicename = '';
  var cards = self.getAlsaCards();
  var valvolumecurvemode = self.config.get('volumecurvemode');
  var valdevice = self.config.get('outputdevice');
  var valvolumemax = self.config.get('volumemax');
  var valmixer = self.config.get('mixer');
  var valmixertype = self.config.get('mixer_type');

  if (valdevice != 'softvolume') {
    if (cards[valdevice] != undefined) {
      var outdevicename = cards[valdevice].name;
    }
  } else {
    var outdevicename = 'softvolume';
  }

  if (valmixertype === 'Software') {
    valdevice = self.config.get('softvolumenumber');
  }
  var valvolumestart = self.config.get('volumestart');
  var valvolumesteps = self.config.get('volumesteps');

  var settings = {
    device: valdevice,
    name: outdevicename,
    mixer: valmixer,
    mixertype: valmixertype,
    maxvolume: valvolumemax,
    volumecurve: valvolumecurvemode,
    volumestart: valvolumestart,
    volumesteps: valvolumesteps,
    volumeOverride: false
  };

  if (deviceVolumeOverride && deviceVolumeOverride.card !== undefined && deviceVolumeOverride.pluginType && deviceVolumeOverride.pluginName) {
    if (deviceVolumeOverride.card.toString() === valdevice.toString()) {
      self.logger.info('Applying Volume Override');
      settings.volumeOverride = true;
      settings.pluginType = deviceVolumeOverride.pluginType;
      settings.pluginName = deviceVolumeOverride.pluginName;
      if (deviceVolumeOverride.overrideMixerType) {
          overrideMixerType = deviceVolumeOverride.overrideMixerType;
          settings.mixertype = deviceVolumeOverride.overrideMixerType;
      } else {
          overrideMixerType = undefined;
      }
      if (deviceVolumeOverride.overrideAvoidSoftwareMixer) {
          overrideAvoidSoftwareMixer = deviceVolumeOverride.overrideAvoidSoftwareMixer;
      } else {
          overrideAvoidSoftwareMixer = false;
      }
    } else {
        overrideMixerType = undefined;
        overrideAvoidSoftwareMixer = false;
    }
  }

  return self.commandRouter.volumioUpdateVolumeSettings(settings);
};

ControllerAlsa.prototype.enablePiJack = function () {
  var self = this;

  self.logger.info('Enabling PI Jack Output');
  exec('/usr/bin/amixer cset -c 0 numid=3 1', function (error, stdout, stderr) {
    if (error) {
      self.logger.error('Cannot Enable Raspberry PI Jack Output: ' + error);
    } else {
      self.logger.info('Raspberry PI Jack Output Enabled ');
      self.storeAlsaSettings();
    }
  });
};

ControllerAlsa.prototype.enablePiHDMI = function () {
  var self = this;

  self.logger.info('Enabling PI HDMI Output');
  exec('/usr/bin/amixer cset -c 0 numid=3 2', function (error, stdout, stderr) {
    if (error) {
      self.logger.error('Cannot Enable Raspberry PI HDMI Output: ' + error);
    } else {
      self.logger.info('Raspberry PI HDMI Output Enabled ');
      self.storeAlsaSettings();
    }
  });
};

ControllerAlsa.prototype.storeAlsaSettings = function () {
  var self = this;
  exec('/usr/bin/sudo /usr/sbin/alsactl store', function (error, stdout, stderr) {
    if (error) {
      self.logger.error('Cannot Store Alsa Settings: ' + error);
    } else {
      self.logger.error('Alsa Settings successfully stored');
    }
  });
};

ControllerAlsa.prototype.getAudioDevices = function () {
  var self = this;

  var defer = libQ.defer();
  var cards = self.getAlsaCards();
  var devicesarray = [];
  var carddetail = '';
  var i2sdevice = '';

  for (var i in cards) {
    if (cards[i].name === 'Audio Jack') {
      carddetail = {'id': cards[i].id, 'name': 'Audio Jack'};
      devicesarray.push(carddetail);
      var carddetail2 = {'id': cards[i].id, 'name': 'HDMI Out'};
      devicesarray.push(carddetail2);
    } else {
      carddetail = {'id': cards[i].id, 'name': cards[i].name};
      devicesarray.push(carddetail);
    }
  }

  var outdevicename = self.config.get('outputdevicename');
  var outputdevice = self.config.get('outputdevice');
  if (outdevicename) {

  } else {
    if (devicesarray.length > 0) {
      outdevicename = devicesarray[0].name;
      outputdevice = devicesarray[0].id;
    } else {
      outdevicename = self.commandRouter.getI18nString('PLAYBACK_OPTIONS.NO_AUDIO_DEVICE_AVAILABLE');
      outputdevice = 'nodev';
    }
  }

  if (volumioDeviceName === 'primo' || self.config.get('ignore_i2s', false)) {
    var i2soptions = [];
  } else {
    var i2soptions = self.commandRouter.executeOnPlugin('system_controller', 'i2s_dacs', 'getI2sOptions');
  }

  var i2sstatus = self.commandRouter.executeOnPlugin('system_controller', 'i2s_dacs', 'getI2sStatus');

  if (i2soptions.length > 0) {
    if (i2sstatus.enabled) {
      i2sdevice = i2sstatus.name;
    } else {
      i2sdevice = i2soptions[0].label;
    }

    var i2sarray = [];
    for (var i in i2soptions) {
      var i2scard = {'id': i2soptions[i].value, 'name': i2soptions[i].label};
      i2sarray.push(i2scard);
    }
    var response = {'devices': {'active': {'name': outdevicename, 'id': outputdevice}, 'available': devicesarray}, 'i2s': {'enabled': i2sstatus.enabled, 'active': i2sdevice, 'available': i2sarray}};
    defer.resolve(response);
  } else {
    var response = {'devices': {'active': {'name': outdevicename, 'id': outputdevice}, 'available': devicesarray}};
    defer.resolve(response);
  }

  return defer.promise;
};

ControllerAlsa.prototype.usbAudioAttach = function () {
  var self = this;

  var usbHotplug = self.config.get('usb_hotplug', true);
  var outdev = this.config.get('outputdevice');
  if (usbHotplug && !ignoreUsbAudioAttach && outdev === '5') {
    var cards = self.getAlsaCards();
    var usbCardName = self.getLabelForSelectedCard(cards, 5);
    var usbData = {'disallowPush': true, 'output_device': {'value': '5', 'label': usbCardName}, 'i2s': false};
    self.commandRouter.pushToastMessage('success', self.commandRouter.getI18nString('PLAYBACK_OPTIONS.USB_DAC_CONNECTED'), usbCardName);
    self.commandRouter.closeModals();
    self.saveAlsaOptions(usbData);
    setTimeout(() => {
      self.commandRouter.executeOnPlugin('music_service', 'raat', 'restartRaat', '');
    }, 500);
  }
};

ControllerAlsa.prototype.usbAudioDetach = function () {
  var self = this;

  if (!ignoreUsbAudioDetach) {
    self.checkAudioDeviceAvailable();
  }
};

ControllerAlsa.prototype.checkAudioDeviceAvailable = function () {
  var self = this;

  var i2sstatus = self.commandRouter.executeOnPlugin('system_controller', 'i2s_dacs', 'getI2sStatus');
  if (i2sstatus !== undefined && i2sstatus.enabled) {
      // If I2S is enabled we skip the device available check
      return;
  }
  var cards = self.getAlsaCards();
  var outdev = this.config.get('outputdevice');
  if (outdev === 'softvolume') {
    outdev = self.config.get('softvolumenumber', 'none');
  }
  var outdevName = this.config.get('outputdevicename');
  if (cards.length === 0) {
    var responseData = {
      title: self.commandRouter.getI18nString('PLAYBACK_OPTIONS.NO_OUTPUT_DEVICE'),
      message: self.commandRouter.getI18nString('PLAYBACK_OPTIONS.NO_OUTPUT_DEVICE_MESSAGE'),
      size: 'lg',
      buttons: [
        {
          name: self.commandRouter.getI18nString('COMMON.GOT_IT'),
          class: 'btn btn-info ng-scope',
          emit: '',
          payload: ''
        }
      ]
    };
    self.commandRouter.broadcastMessage('openModal', responseData);
    self.commandRouter.executeOnPlugin('music_service', 'raat', 'onStop', '');
  } else {
    	var found = false;
    	for (var i in cards) {
    		var currentCard = cards[i];
    		if (currentCard && currentCard.id && currentCard.name && currentCard.id === outdev && currentCard.name === outdevName) {
    			found = true;
      }
    }
    if (!found && outdevName !== undefined) {
    		var message = self.commandRouter.getI18nString('PLAYBACK_OPTIONS.CONNECT_OUTPUT_DEVICE_1') + ' ' + outdevName + ' ' + self.commandRouter.getI18nString('PLAYBACK_OPTIONS.CONNECT_OUTPUT_DEVICE_2');
      var responseData = {
        title: self.commandRouter.getI18nString('PLAYBACK_OPTIONS.OUTPUT_DEVICE_NOT_AVAILABLE'),
        message: message,
        size: 'lg',
        buttons: [
          {
            name: self.commandRouter.getI18nString('COMMON.GOT_IT'),
            class: 'btn btn-info ng-scope',
            emit: '',
            payload: ''
          }
        ]
      };
      self.commandRouter.broadcastMessage('openModal', responseData);
      self.commandRouter.executeOnPlugin('music_service', 'raat', 'onStop', '');
    }
  }
};

ControllerAlsa.prototype.ignoreUsbAudioDetach = function (value) {
  var self = this;

  ignoreUsbAudioDetach = value;
};

ControllerAlsa.prototype.ignoreUsbAudioAttach = function (value) {
  var self = this;

  ignoreUsbAudioAttach = value;
};

ControllerAlsa.prototype.checkCurrentAudioDeviceAvailable = function () {
  var self = this;

  var currentDeviceNumber = self.config.get('outputdevice', 'none');
  if (currentDeviceNumber === 'softvolume') {
    	currentDeviceNumber = self.config.get('softvolumenumber', 'none');
  }
  var cards = self.getAlsaCards();
  if (cards.length === 0) {
    return false;
  } else {
    	var found = false;
    	for (var i in cards) {
    		if (cards[i].id == currentDeviceNumber) {
    			found = true;
      }
    }
    return found;
  }
};

ControllerAlsa.prototype.restorePreviousVolumeLevel = function (volume, mute, softmixer) {
  var self = this;

  self.logger.info('Restoring Previous Volume level: ' + volume + ' ' + mute + ' ' + softmixer);
  if (softmixer) {
    self.commandRouter.volumiosetvolume(100);
  }

  setTimeout(() => {
    self.commandRouter.volumiosetvolume(parseInt(volume));
    if (mute) {
        	// self.commandRouter.volumiosetvolume('mute');
    } else {
        	// self.commandRouter.volumiosetvolume('unmute');
    }
  }, 4500);
};

ControllerAlsa.prototype.checkValidMixer = function (mixerName) {
  var self = this;

  var invalidMixersNames = ['Clock Validity', 'Tx Source', 'Internal Validity'];
  var isValidMixer = true;

  for (var i in invalidMixersNames) {
    if (mixerName.indexOf(invalidMixersNames[i]) > -1) {
        	isValidMixer = false;
    }
  }

  return isValidMixer;
};

ControllerAlsa.prototype.setDeviceVolumeOverride = function (data) {
    var self = this;
    self.logger.info('Setting Device Volume Override');

    if (data && data.card !== undefined && data.pluginType && data.pluginName) {
        deviceVolumeOverride = data;
        this.updateVolumeSettings();
    } else {
        self.logger.error('Failed to set Device Volume Override: missing parameters');
    }
};

ControllerAlsa.prototype.getAlsaCardsWithoutI2SDAC = function (data) {
    var self = this;
    self.logger.info('Getting Alsa Cards List without I2S DAC');

    var cards = self.getAlsaCards();
    var cardsWithoutI2S = [];
    var i2sNumber = self.commandRouter.executeOnPlugin('system_controller', 'i2s_dacs', 'getI2SNumber');
    var cards = self.getAlsaCards();

    for (var i in cards) {
        if (i2sNumber !== cards[i].id) {
            cardsWithoutI2S.push(cards[i]);
        }
    }

    return cardsWithoutI2S;
};