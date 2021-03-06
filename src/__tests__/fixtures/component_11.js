/**
 * Testing component using Flow
 */

import React from 'react';

import { OtherComponentProps as OtherProps } from 'NonExistentFile';

type OtherLocalProps = {|
   /**
   * fooProp is spread in from a locally resolved type
   */
  fooProp?: string,
|}

type Props = {|
  /**
   * Spread props defined locally
   */
  ...OtherLocalProps,

  /**
   * Spread props from another file
   */
  ...OtherProps,

  /**
   * The first prop
   */
  prop1: string,

  /**
   * The second, covariant prop
   */
  +prop2: number
|}

class MyComponent extends React.Component<Props> {
  render() {
    return null;
  }
}

export default MyComponent;
