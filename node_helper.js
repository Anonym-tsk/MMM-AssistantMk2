//
// Module : MMM-AssistantMk2
//

const path = require("path")
const exec = require("child_process").exec
const fs = require("fs")
const Assistant = require("./components/assistant.js")
const ScreenParser = require("./components/screenParser.js")
const ActionManager = require("./components/actionManager.js")

var _log = function() {
  var context = "[AMK2]"
  return Function.prototype.bind.call(console.log, console, context)
}()

var log = function() {
  //do nothing
}

var NodeHelper = require("node_helper")

module.exports = NodeHelper.create({
  start: function () {
    this.config = {}
  },

  socketNotificationReceived: function (noti, payload) {
    switch (noti) {
      case "INIT":
        this.initialize(payload)
        break
      case "ACTIVATE_ASSISTANT":
        this.activateAssistant(payload)
        break
      case "SHELLEXEC":
        var command = payload.command
        command += (payload.options) ? (" " + payload.options) : ""
        exec (command, (e,so,se)=> {
          log("ShellExec command:", command)
          if (e) log("ShellExec Error:", e)
          this.sendSocketNotification("SHELLEXEC_RESULT", {
            executed: payload,
            result: {
              error: e,
              stdOut: so,
              stdErr: se,
            }
          })
        })
        break
    }
  },

  tunnel: function(payload) {
    this.sendSocketNotification("TUNNEL", payload)
  },

  activateAssistant: function(payload) {
    log("QUERY:", payload)
    // payload: {
    //    type: "TEXT", "MIC", "WAVEFILE",
    //    key : "query" for "TEXT"
    //    profile: "",
    //    lang: "" (optional) // if you want to force to change language
    //    useScreenOutput: true (optional) // if you want to force to set using screenoutput
    // }
    var assistantConfig = Object.assign({}, this.config.assistantConfig)
    assistantConfig.debug = this.config.debug
    assistantConfig.session = payload.session
    assistantConfig.lang = (payload.lang) ? payload.lang : ((payload.profile.lang) ? payload.profile.lang : null)
    assistantConfig.useScreenOutput = payload.useScreenOutput
    assistantConfig.micConfig = this.config.micConfig
    this.assistant = new Assistant(assistantConfig, (obj)=>{this.tunnel(obj)})

    var parserConfig = {
      screenOutputCSS: this.config.responseConfig.screenOutputCSS,
      screenOutputURI: "tmp/lastScreenOutput.html",
      screenZoom: this.config.responseConfig.screenZoom
    }
    var parser = new ScreenParser(parserConfig, this.config.debug)
    var result = null
    this.assistant.activate(payload, (response)=> {
      response.lastQuery = payload
      if (!(response.screen || response.audio)) {
        response.error = "NO_RESPONSE"
        if (response.transcription && response.transcription.transcription && !response.transcription.done) {
          response.error = "TRANSCRIPTION_FAILS"
        }
      }
      if (response.error == "TOO_SHORT" && response) response.error = null
      if (response.screen) {
        parser.parse(response, (result)=>{
          delete result.screen.originalContent
          log(result)
          this.sendSocketNotification("ASSISTANT_RESULT", result)
        })
      } else {
        log (response)
        this.sendSocketNotification("ASSISTANT_RESULT", response)
      }
    })
  },

  initialize: function (config) {
    this.config = config
    this.config.assistantConfig["modulePath"] = __dirname
    if (this.config.debug) log = _log
    log("MMM-AssistantMk2 Version:", require('./package.json').version)
    /**
     * TODO: check whether credentialPath exists.
     */
    this.loadRecipes(()=>{
      this.sendSocketNotification("INITIALIZED")
    })
    this.cleanUptmp()
    log("Response delay is set to " + this.config.responseConfig.delay + ((this.config.responseConfig.delay > 1) ? " seconds" : " second"))
    log("AssistantMk2 v3 is initialized.")
  },

  cleanUptmp: function() {
    var tmp = path.resolve(this.config.assistantConfig["modulePath"], "tmp")
    var command = "cd " + tmp + "; rm *.mp3; rm *.html"
    exec(command, (error,stdout, stderr)=>{
      log("tmp directory is now cleaned.")
    })
  },

  loadRecipes: function(callback=()=>{}) {
    if (this.config.recipes) {
      let replacer = (key, value) => {
        if (typeof value == "function") {
          return "__FUNC__" + value.toString()
        }
        return value
      }
      var recipes = this.config.recipes
      for (var i = 0; i < recipes.length; i++) {
        try {
          var p = require("./recipes/" + recipes[i]).recipe
          this.sendSocketNotification("LOAD_RECIPE", JSON.stringify(p, replacer, 2))
          if (p.actions) this.config.actions = Object.assign({}, this.config.actions, p.actions)
          log("RECIPE_LOADED:", recipes[i])
        } catch (e) {
          log(`RECIPE_ERROR (${recipes[i]}):`, e.message)
        }
      }
      if (this.config.actions && Object.keys(this.config.actions).length > 1) {
        var actionConfig = Object.assign({}, this.config.customActionConfig)
        actionConfig.actions = Object.assign({}, this.config.actions)
        actionConfig.projectId = this.config.assistantConfig.projectId
        var Manager = new ActionManager(actionConfig, this.config.debug)
        Manager.makeAction(callback)
      } else {
        log("NO_ACTION_TO_MANAGE")
        callback()
      }
    } else {
      log("NO_RECIPE_TO_LOAD")
      callback()
    }
  },

})
