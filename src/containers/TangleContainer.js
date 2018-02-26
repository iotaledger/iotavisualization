import React from 'react';
import PropTypes from 'prop-types';
import Tangle from '../components/Tangle';
import {connect} from 'react-redux';
import * as d3Force from 'd3-force';
import {scaleLinear} from 'd3-scale';
import {generateTangle} from '../shared/generateData';
import Slider from 'rc-slider';
import Tooltip from 'rc-tooltip';
import 'rc-slider/assets/index.css';
import 'rc-tooltip/assets/bootstrap.css';
import {getAncestors, getDescendants, getTips} from '../shared/algorithms';
import './radio-button.css';
import {uniformRandom, unWeightedMCMC, weightedMCMC} from '../shared/tip-selection';
import '../components/Tangle.css';
import SliderContainer from './SliderContainer';

const mapStateToProps = (state, ownProps) => ({});
const mapDispatchToProps = (dispatch, ownProps) => ({});

const nodeRadiusMax = 25;
const nodeRadiusMin = 13;
const showLabelsMinimumRadius = 21;
const getNodeRadius = nodeCount => {
  const smallNodeCount = 20;
  const largeNodeCount = 100;

  if (nodeCount < smallNodeCount) {
    return nodeRadiusMax;
  }
  if (nodeCount > largeNodeCount) {
    return nodeRadiusMin;
  }
  const scale = scaleLinear().domain([smallNodeCount, largeNodeCount]);
  scale.range([nodeRadiusMax, nodeRadiusMin]);

  return scale(nodeCount);
};

const tipSelectionDictionary = {
  'UR': {
    algo: uniformRandom,
    label: 'Uniform Random',
  },
  'UWRW': {
    algo: unWeightedMCMC,
    label: 'Unweighted Random Walk',
  },
  'WRW': {
    algo: weightedMCMC,
    label: 'Weighted Random Walk',
  },
};

const leftMargin = 10;
const rightMargin = 10;
const bottomMargin = 190;

const nodeCountMin = 1;
const nodeCountMax = 500;
const nodeCountDefault = 20;
const lambdaMin = 0.1;
const lambdaMax = 50;
const lambdaDefault = 1.5;
const alphaMin = 0;
const alphaMax = 5;
const alphaDefault = 0.5;

const Handle = Slider.Handle;
const sliderHandle = props => {
  const {value, dragging, index, ...restProps} = props;
  return (
    <Tooltip
      prefixCls='rc-slider-tooltip'
      overlay={value}
      visible={dragging}
      placement='top'
      key={index}
    >
      <Handle value={value} {...restProps} />
    </Tooltip>
  );
};

sliderHandle.propTypes = {
  value: PropTypes.number.isRequired,
  dragging: PropTypes.bool.isRequired,
  index: PropTypes.number.isRequired,
};

const TipAlgorithmLabel = ({selectedAlgorithm, onChange, algoKey}) =>
  <label className='container' key={algoKey}>
    <div style={{fontSize: 10}}>
      {tipSelectionDictionary[algoKey].label}
    </div>
    <input type='radio' name='radio' value={algoKey}
      checked={selectedAlgorithm === algoKey}
      onChange={onChange}
    />
    <span className='checkmark'></span>
  </label>;

TipAlgorithmLabel.propTypes = {
  selectedAlgorithm: PropTypes.string.isRequired,
  onChange: PropTypes.any,
  algoKey: PropTypes.string.isRequired,
};


class TangleContainer extends React.Component {
  constructor(props) {
    super();

    this.state = {
      nodes: [],
      links: [],
      nodeCount: nodeCountDefault,
      lambda: lambdaDefault,
      alpha: alphaDefault,
      width: 300, // default values
      height: 300,
      nodeRadius: getNodeRadius(nodeCountDefault),
      tipSelectionAlgorithm: 'UR',
    };
    this.updateWindowDimensions = this.updateWindowDimensions.bind(this);

    this.force = d3Force.forceSimulation();
    this.force.alphaDecay(0.1);

    this.force.on('tick', () => {
      this.force.nodes(this.state.nodes);

      // restrict nodes to window area
      for (let node of this.state.nodes) {
        node.y = Math.max(this.state.nodeRadius, Math.min(this.state.height - this.state.nodeRadius, node.y));
      }

      this.setState({
        links: this.state.links,
        nodes: this.state.nodes,
      });
    });
  }
  componentWillUnmount() {
    this.force.stop();
    window.removeEventListener('resize', this.updateWindowDimensions);
  }
  componentDidMount() {
    this.startNewTangle();
    this.updateWindowDimensions();
    window.addEventListener('resize', this.updateWindowDimensions);
  }
  updateWindowDimensions() {
    this.setState({
      width: window.innerWidth - leftMargin - rightMargin,
      height: window.innerWidth < 768 ? window.innerHeight : window.innerHeight - bottomMargin,
    }, () => {
      this.recalculateFixedPositions();
      this.force
        .force('no_collision', d3Force.forceCollide().radius(this.state.nodeRadius * 2).strength(0.01).iterations(15))
        .force('pin_y_to_center', d3Force.forceY().y(d => this.state.height / 2).strength(0.1))
        .force('pin_x_to_time', d3Force.forceX().x(d => this.xFromTime(d.time)).strength(1))
        .force('link', d3Force.forceLink().links(this.state.links).strength(0.5).distance(this.state.nodeRadius*3)); // strength in [0,1]

      this.force.restart().alpha(1);
    });
  }
  startNewTangle() {
    const nodeRadius = getNodeRadius(this.state.nodeCount);
    const tangle = generateTangle({
      nodeCount: this.state.nodeCount,
      lambda: this.state.lambda,
      alpha: this.state.alpha,
      nodeRadius,
      tipSelectionAlgorithm: tipSelectionDictionary[this.state.tipSelectionAlgorithm].algo,
    });

    const {width, height} = this.state;

    for (let node of tangle.nodes) {
      node.y = height/4 + Math.random()*(height/2),
      node.x = width/2; // required to avoid annoying errors
    }

    this.force.stop();

    this.setState({
      nodes: tangle.nodes,
      links: tangle.links,
      nodeRadius,
    }, () => {
      // Set all nodes' x by time value after state has been set
      this.recalculateFixedPositions();
    });

    this.force.restart().alpha(1);
  }
  recalculateFixedPositions() {
    // Set genesis's y to center
    const genesisNode = this.state.nodes[0];
    genesisNode.fx = this.setState.height / 2;

    for (let node of this.state.nodes) {
      node.fx = this.xFromTime(node.time);
    }
  }
  xFromTime(time) {
    const padding = this.state.nodeRadius;
    // Avoid edge cases with 0 or 1 nodes
    if (this.state.nodes.length < 2) {
      return padding;
    }

    const maxTime = this.state.nodes[this.state.nodes.length-1].time;

    // Rescale nodes' x to cover [margin, width-margin]
    const scale = scaleLinear().domain([0, maxTime]);
    scale.range([padding, this.state.width - padding]);

    return scale(time);
  }
  mouseEntersNodeHandler(e) {
    const name = e.target.getAttribute('name');
    this.setState({
      hoveredNode: this.state.nodes.find(node => node.name === name),
    });
  }
  mouseLeavesNodeHandler(e) {
    this.setState({
      hoveredNode: undefined,
    });
  }
  getApprovedNodes(root) {
    if (!root) {
      return {nodes: new Set(), links: new Set()};
    }

    return getDescendants({
      nodes: this.state.nodes,
      links: this.state.links,
      root,
    });
  }
  getApprovingNodes(root) {
    if (!root) {
      return {nodes: new Set(), links: new Set()};
    }

    return getAncestors({
      nodes: this.state.nodes,
      links: this.state.links,
      root,
    });
  }
  handleTipSelectionRadio(event) {
    this.setState({
      tipSelectionAlgorithm: event.target.value,
    }, () => {
      this.startNewTangle();
    });
  }
  render() {
    const {nodeCount,lambda,alpha, width, height} = this.state;
    const approved = this.getApprovedNodes(this.state.hoveredNode);
    const approving = this.getApprovingNodes(this.state.hoveredNode);

    return (
      <div>
        <div className='top-bar-container' style={{width}}>
          <div className='left-cell'></div>
          <div className='right-cell'></div>
          <div className='top-bar-row'>
            <div className='slider-title'>Number of transactions</div>
            <div className='slider-container'>
              <SliderContainer
                min={nodeCountMin}
                max={nodeCountMax}
                defaultValue={nodeCountDefault}
                value={nodeCount}
                step={1}
                marks={{[nodeCountMin]: `${nodeCountMin}`, [nodeCountMax]: `${nodeCountMax}`}}
                handle={sliderHandle}
                onChange={nodeCount => {
                  this.setState(Object.assign(this.state, {nodeCount}));
                  this.startNewTangle();
                }} />
            </div>
            <div className='tip-algo-label'>
              <TipAlgorithmLabel
                algoKey='UR'
                selectedAlgorithm={this.state.tipSelectionAlgorithm}
                onChange={this.handleTipSelectionRadio.bind(this)} />
            </div>
          </div>
          <div className='top-bar-row'>
            <div className='slider-title'>Transaction rate (λ)</div>
            <div className='slider-container'>
              <SliderContainer
                min={lambdaMin}
                max={lambdaMax}
                step={0.2}
                defaultValue={lambdaDefault}
                value={lambda}
                marks={{[lambdaMin]: `${lambdaMin}`, [lambdaMax]: `${lambdaMax}`}}
                handle={sliderHandle}
                onChange={lambda => {
                  this.setState(Object.assign(this.state, {lambda}));
                  this.startNewTangle();
                }} />
            </div>
            <div className='tip-algo-label'>
              <TipAlgorithmLabel
                algoKey='UWRW'
                selectedAlgorithm={this.state.tipSelectionAlgorithm}
                onChange={this.handleTipSelectionRadio.bind(this)} />
            </div>
          </div>
          <div className='top-bar-row'>
            <div className='slider-title'>alpha</div>
            <div className='slider-container'>
              <SliderContainer
                min={alphaMin}
                max={alphaMax}
                step={0.001}
                defaultValue={alphaDefault}
                value={alpha}
                marks={{[alphaMin]: `${alphaMin}`, [alphaMax]: `${alphaMax}`}}
                handle={sliderHandle}
                disabled={this.state.tipSelectionAlgorithm !== 'WRW'}
                onChange={alpha => {
                  this.setState(Object.assign(this.state, {alpha}));
                  this.startNewTangle();
                }} />
            </div>
            <div className='tip-algo-label'>
              <TipAlgorithmLabel
                algoKey='WRW'
                selectedAlgorithm={this.state.tipSelectionAlgorithm}
                onChange={this.handleTipSelectionRadio.bind(this)} />
            </div>
          </div>
        </div>
        <Tangle links={this.state.links} nodes={this.state.nodes}
          nodeCount={6}
          width={width}
          height={height}
          leftMargin={leftMargin}
          rightMargin={rightMargin}
          nodeRadius={this.state.nodeRadius}
          mouseEntersNodeHandler={this.mouseEntersNodeHandler.bind(this)}
          mouseLeavesNodeHandler={this.mouseLeavesNodeHandler.bind(this)}
          approvedNodes={approved.nodes}
          approvedLinks={approved.links}
          approvingNodes={approving.nodes}
          approvingLinks={approving.links}
          hoveredNode={this.state.hoveredNode}
          hoveredNodeWeight={approving.nodes.size + 1} // Assume each node weight is 1
          hoveredNodeScore={approved.nodes.size + 1}
          tips={getTips({
            nodes: this.state.nodes,
            links: this.state.links,
          })}
          showLabels={this.state.nodeRadius > showLabelsMinimumRadius ? true : false}
        />
      </div>
    );
  }
}

const TangleContainerConnected = connect(
  mapStateToProps,
  mapDispatchToProps
)(TangleContainer);

export default TangleContainerConnected;
