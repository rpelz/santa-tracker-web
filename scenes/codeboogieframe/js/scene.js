/*
 * Copyright 2015 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. You may obtain a copy of
 * the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations under
 * the License.
 */

goog.provide('app.Scene');

goog.require('app.AnimationPlayer');
goog.require('app.BlockRunner');
goog.require('app.InputEvent');
goog.require('app.ResultType');
goog.require('app.SceneTutorial');
goog.require('goog.style');

/**
 * The main view for the maze game. Manages the gameplay viewport and
 * graphics which appear to the right of the blockly scene.
 *
 * @param {!Element} el root .scene element.
 * @param {!app.Game} game instance.
 * @param {!app.Blockly} blockly wrapper.
 * @constructor
 */
app.Scene = function(el, game, blockly) {
  this.active_ = true;
  this.blockly_ = blockly;
  this.player = new app.AnimationPlayer(el);
  this.blockRunner_ = new app.BlockRunner(this, blockly);
  this.cachedWindowHeight_ = null;
  this.cachedWindowWidth_ = null;
  this.el_ = el;
  this.game = game;
  /* @type {app.Level} */
  this.level = null;
  this.portraitMode_ = false;
  this.scaleRatio_ = 1;
  this.squares_ = [];
  this.visible_ = false;

  // The world stage
  this.underlayEl_ = el.parentNode.querySelector('.scene-underlay');
  this.worldEl_ = el.querySelector('.scene__world');
  this.buttonEl_ = el.querySelector('.scene__play');

  // Portrait draggability
  var dummy = new KeyframeEffect(document.body, [], 0);
  this.dragPlayer_ = document.timeline.play(dummy);
  this.dragStartTime_ = null;
  this.dragStartX_ = null;
  this.dragLastX_ = null;
  this.dragDirection_ = null;

  // Bind handlers
  this.calculateViewport_ = this.calculateViewport_.bind(this);
  this.onClickRun_ = this.onClickRun_.bind(this);
  this.onMouseDown_ = this.onMouseDown_.bind(this);
  this.onMouseMove_ = this.onMouseMove_.bind(this);
  this.onMouseUp_ = this.onMouseUp_.bind(this);

  // Calculate the viewport now and whenever the browser resizes.
  window.addEventListener('resize', this.calculateViewport_, false);
  this.calculateViewport_();

  // Other events
  this.buttonEl_.addEventListener('click', this.onClickRun_, false);
  this.el_.addEventListener(app.InputEvent.START, this.onMouseDown_, false);
  this.underlayEl_.addEventListener(app.InputEvent.START, this.onMouseDown_, false);
  window.addEventListener(app.InputEvent.MOVE, this.onMouseMove_, false);
  window.addEventListener(app.InputEvent.END, this.onMouseUp_, false);
};

/**
 * Base width of scene contents.
 * @type {number}
 */
app.Scene.CONTENT_WIDTH = 400;

/**
 * Base height of scene contents.
 * @type {number}
 */
app.Scene.CONTENT_HEIGHT = 400;

/**
 * Minimum margin from scene contents to edge.
 * @type {number}
 */
app.Scene.SCENE_PADDING = 20;

/**
 * Clean up resources. Not really used atm as our iframe will be destroyed anyways when
 * leaving this game.
 */
app.Scene.prototype.dispose = function() {
  window.removeEventListener('resize', this.calculateViewport_, false);

  this.buttonEl_.removeEventListener('click', this.onClickRun_, false);
  this.el_.removeEventListener(app.InputEvent.START, this.onMouseDown_, false);
  this.underlayEl_.removeEventListener(app.InputEvent.START, this.onMouseDown_, false);
  window.removeEventListener(app.InputEvent.MOVE, this.onMouseMove_, false);
  window.removeEventListener(app.InputEvent.END, this.onMouseUp_, false);
};

/**
 * Resets the state of the scene for a new game.
 */
app.Scene.prototype.reset = function() {
  this.level = null;
};

/**
 * Changes the current level.
 * @param {number} level
 */
app.Scene.prototype.setLevel = function(level) {
  this.level = level;

  // Show the scene in portrait, then hide it after 3 seconds.
  this.portraitToggleScene(true);
  window.setTimeout(this.portraitToggleScene.bind(this, false), 3000);
};

/**
 * Resets state to the current level. Need to reset graphics as well when changing levels
 * or restarting the level. Does not need to reset graphics after doing a dry run of
 * blocks.
 */
app.Scene.prototype.restartLevel = function() {
  this.blockRunner_.restartLevel();
};

/**
 * Configures scaling and width of scene elements. Runs on init and resize.
 * @private
 */
app.Scene.prototype.calculateViewport_ = function() {
  // Blockly spams window.onresize for their scrollbar logic. Let's ignore those.
  if (window.innerHeight === this.cachedWindowHeight_ &&
      window.innerWidth === this.cachedWindowWidth_) {
    return;
  }
  this.cachedWindowHeight_ = window.innerHeight;
  this.cachedWindowWidth_ = window.innerWidth;

  // Calculate width and scaling for the scene, with special handling for portrait-like
  // windows.
  var sceneHeight = window.innerHeight;
  var contentAspectRatio = app.Scene.CONTENT_WIDTH / app.Scene.CONTENT_HEIGHT;
  var sceneAspectRatio = Math.min(window.innerWidth / 2 / sceneHeight, contentAspectRatio);
  var sceneWidth = sceneHeight * sceneAspectRatio;

  var portraitMode = false;
  var workspaceWidth = window.innerWidth - this.blockly_.getToolbarWidth();
  if (workspaceWidth - sceneWidth < app.Constants.BLOCKLY_MIN_WIDTH) {
    portraitMode = true;
    sceneWidth = window.innerWidth - app.Constants.EDGE_MIN_WIDTH;
  }

  this.portraitMode_ = portraitMode;
  this.width_ = sceneWidth;
  if (sceneWidth / sceneHeight > contentAspectRatio) {
    this.scaleRatio_ = (sceneHeight - app.Scene.SCENE_PADDING * 2) / app.Scene.CONTENT_HEIGHT;
  } else {
    this.scaleRatio_ = (sceneWidth - app.Scene.SCENE_PADDING * 2) / app.Scene.CONTENT_WIDTH;
  }

  // Apply width and scaling in DOM.
  this.el_.style.fontSize = this.scaleRatio_ * 10 + 'px';
  this.el_.style.width = sceneWidth + 'px';

  this.configPortraitDraggability_();
};

/**
 * Disables or enables and reconfigures the expand/collapse animation for portrait.
 * @private
 */
app.Scene.prototype.configPortraitDraggability_ = function() {
  if (this.portraitMode_) {
    this.dragPlayer_ = document.timeline.play(new GroupEffect([
      new KeyframeEffect(this.el_, [
        {transform: 'translate3d(0, 0, 0)'},
        {transform: 'translate3d(' + (this.width_ - app.Constants.EDGE_MIN_WIDTH) + 'px, 0, 0)'}
      ], {duration: app.Constants.SCENE_TOGGLE_DURATION, fill: 'forwards'}),
      new KeyframeEffect(this.underlayEl_, [
        {opacity: 1, visibility: 'visible'},
        {opacity: 0, visibility: 'visible', offset: 0.95},
        {opacity: 0, visibility: 'hidden'}
      ], {duration: app.Constants.SCENE_TOGGLE_DURATION, fill: 'forwards'})
    ], {fill: 'forwards'}));
    this.dragPlayer_.pause();
  } else if (this.dragPlayer_) {
    this.dragPlayer_.cancel();
  }
};

/**
 * Mouse/touch down handler for portrait mode. Stores mouse/tap position
 * for other handlers to use.
 * @param {MouseEvent|TouchEvent} e event object.
 * @private
 */
app.Scene.prototype.onMouseDown_ = function(e) {
  if (!this.portraitMode_) {
    return;
  }

  e = app.InputEvent.normalize(e);
  this.dragLastX_ = this.dragStartX_ = e.clientX;
};

/**
 * Mouse/touch move handler for portrait mode. Starts moving the scene if
 * dragged far enough.
 * @param {MouseEvent|TouchEvent} e event object.
 * @private
 */
app.Scene.prototype.onMouseMove_ = function(e) {
  if (this.dragStartX_ == null) {
    return;
  }
  e.preventDefault();

  // Figure out if we have dragged far enough to start moving the scene.
  e = app.InputEvent.normalize(e);
  var deltaX = e.clientX - this.dragStartX_;
  if (this.dragStartTime_ == null) {
    if (Math.abs(deltaX) < app.Constants.SCENE_TOGGLE_MIN_DRAG) {
      return;
    }
    this.dragStartTime_ = this.dragPlayer_.currentTime;
    this.dragPlayer_.pause();
  }

  // Figure out which direction is currently being dragged in.
  // Could be more elaborate for sure.
  this.dragDirection_ = (e.clientX - this.dragLastX_) === 0 ?
      this.dragDirection_ :
      (e.clientX - this.dragLastX_) < 0;
  this.dragLastX_ = e.clientX;

  // Calculate a currentTime for the animation based on drag.
  var newCurrentTime = this.dragStartTime_ +
      deltaX / this.width_ * app.Constants.SCENE_TOGGLE_DURATION;
  newCurrentTime = Math.max(0, Math.min(app.Constants.SCENE_TOGGLE_DURATION, newCurrentTime));
  this.dragPlayer_.currentTime = newCurrentTime;
};

/**
 * Mouse/touch up handler for portrait mode. Makes sure the scene is either
 * visible or hidden. Also checks if the user clicked/tapped to show/hide the
 * scene.
 * @param {MouseEvent|TouchEvent} e event object.
 * @private
 */
app.Scene.prototype.onMouseUp_ = function(e) {
  if (this.dragStartX_ == null) {
    return;
  }

  // We're either finishing an elaborate tap, or finishing a drag. Let's figure out if we should
  // expand or collapse.
  var didTap = this.dragStartTime_ == null && e.target !== this.buttonEl_;

  var makeVisible = didTap ?
      this.dragPlayer_.currentTime > app.Constants.SCENE_TOGGLE_DURATION / 2 :
      this.dragDirection_;
  var tappingUnderlay = e.target === this.underlayEl_;
  var didTapCorrectSide = didTap && tappingUnderlay === !makeVisible;

  var notAtEnd = this.dragPlayer_.currentTime > 0 &&
      this.dragPlayer_.currentTime < app.Constants.SCENE_TOGGLE_DURATION;

  if (didTapCorrectSide || notAtEnd) {
    this.portraitToggleScene(makeVisible);
  }

  this.dragStartX_ = null;
  this.dragStartTime_ = null;
};

/**
 * Checks if the scene is currently visible in portrait mode.
 * @return {boolean} true if visible.
 * @private
 */
app.Scene.prototype.isSceneVisibleInPortrait_ = function() {
  return this.dragPlayer_.currentTime === 0;
};

/**
 * Conditionally show or hide the scene with animation in portrait mode.
 * @param {boolean} visible true if the scene should be shown.
 */
app.Scene.prototype.portraitToggleScene = function(visible) {
  if (!this.portraitMode_) {
    return;
  }

  var targetTime = visible ? 0 : app.Constants.SCENE_TOGGLE_DURATION;
  if (this.dragPlayer_.currentTime === targetTime) {
    return;
  }

  this.dragPlayer_.playbackRate = visible ? -1 : 1;
  this.dragPlayer_.play();
};

/**
 * Click handler on play button. Starts execution of the blockly code.
 * @private
 */
app.Scene.prototype.onClickRun_ = function() {
  this.buttonEl_.blur();

  if (this.portraitMode_ && !this.isSceneVisibleInPortrait_()) {
    this.portraitToggleScene(true);
    window.setTimeout(this.blockRunner_.execute.bind(this.blockRunner_),
        app.Constants.SCENE_TOGGLE_DURATION);
  } else {
    this.blockRunner_.execute();
  }
};

/**
 * Callback after running the blockly code. Presents user with smart
 * success or failure messages.
 * @param {app.LevelResult} result of execution.
 */
app.Scene.prototype.onFinishExecution = function(result) {
  if (this.level === app.levels[app.levels.length - 1]) {
    result.overlayGraphic = result.levelComplete ? '#result-final' : null;
    result.isFinalLevel = true;
  }

  if (result.levelComplete) {
    this.game.successResult.show(result);
  } else {
    // this.game.failureResult.show(result);
  }
};

/**
 * Returns the width the scene steals from the blockly workspace.
 * @return {number} minimum size of scene in pixels.
 */
app.Scene.prototype.getWidth = function() {
  if (!this.visible_) {
    return 0;
  } else if (this.portraitMode_) {
    return app.Constants.EDGE_MIN_WIDTH;
  } else {
    return this.width_;
  }
};

/**
 * Sets if the maze viewport should be visible or not. Depends on the active level.
 * @param {boolean} visible should be true to show the maze.
 */
app.Scene.prototype.toggleVisibility = function(visible) {
  if (this.visible_ === visible) {
    return;
  }
  this.visible_ = visible;

  // Keep it simple for now. Translation animation might conflict with portrait dragging.
  this.el_.style.display = visible ? 'block' : 'none';
  this.underlayEl_.style.display = visible ? 'block' : 'none';
};
