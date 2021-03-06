/*eslint no-use-before-define: 0*/

import { namedTypes as t } from 'ast-types';
import { getDocblock } from '../utils/docblock';
import getMembers from './getMembers';
import getPropertyName from './getPropertyName';
import isRequiredPropType from '../utils/isRequiredPropType';
import printValue from './printValue';
import resolveToValue from './resolveToValue';
import resolveObjectKeysToArray from './resolveObjectKeysToArray';
import resolveObjectValuesToArray from './resolveObjectValuesToArray';
import type { Importer } from '../parse';
import type { PropTypeDescriptor, PropDescriptor } from '../Documentation';
import type { NodePath } from 'ast-types/lib/node-path';

function getEnumValues(
  path: NodePath,
  importer: Importer,
): Array<Record<string, unknown>> {
  const values: Array<Record<string, unknown>> = [];

  path.get('elements').each(function (elementPath) {
    if (t.SpreadElement.check(elementPath.node)) {
      const value = resolveToValue(elementPath.get('argument'), importer);

      if (t.ArrayExpression.check(value.node)) {
        // if the SpreadElement resolved to an Array, add all their elements too
        return values.push(...getEnumValues(value, importer));
      } else {
        // otherwise we'll just print the SpreadElement itself
        return values.push({
          value: printValue(elementPath),
          computed: !t.Literal.check(elementPath.node),
        });
      }
    }

    // try to resolve the array element to it's value
    const value = resolveToValue(elementPath, importer);
    return values.push({
      value: printValue(value),
      computed: !t.Literal.check(value.node),
    });
  });

  return values;
}

function getPropTypeOneOf(
  argumentPath: NodePath,
  importer: Importer,
): PropTypeDescriptor {
  const type: PropTypeDescriptor = { name: 'enum' };
  const value: NodePath | null = resolveToValue(argumentPath, importer);
  if (!t.ArrayExpression.check(value.node)) {
    const objectValues =
      resolveObjectKeysToArray(value, importer) ||
      resolveObjectValuesToArray(value, importer);
    if (objectValues) {
      type.value = objectValues.map(objectValue => ({
        value: objectValue,
        computed: false,
      }));
    } else {
      // could not easily resolve to an Array, let's print the original value
      type.computed = true;
      type.value = printValue(argumentPath);
    }
  } else {
    type.value = getEnumValues(value, importer);
  }
  return type;
}

function getPropTypeOneOfType(
  argumentPath: NodePath,
  importer: Importer,
): PropTypeDescriptor {
  const type: PropTypeDescriptor = { name: 'union' };
  if (!t.ArrayExpression.check(argumentPath.node)) {
    type.computed = true;
    type.value = printValue(argumentPath);
  } else {
    type.value = argumentPath.get('elements').map(function (itemPath) {
      const descriptor: PropTypeDescriptor = getPropType(itemPath, importer);
      const docs = getDocblock(itemPath);
      if (docs) {
        descriptor.description = docs;
      }
      return descriptor;
    });
  }
  return type;
}

function getPropTypeArrayOf(argumentPath: NodePath, importer: Importer) {
  const type: PropTypeDescriptor = { name: 'arrayOf' };

  const docs = getDocblock(argumentPath);
  if (docs) {
    type.description = docs;
  }

  const subType = getPropType(argumentPath, importer);

  // @ts-ignore
  if (subType.name === 'unknown') {
    type.value = printValue(argumentPath);
    type.computed = true;
  } else {
    type.value = subType;
  }
  return type;
}

function getPropTypeObjectOf(argumentPath: NodePath, importer: Importer) {
  const type: PropTypeDescriptor = { name: 'objectOf' };

  const docs = getDocblock(argumentPath);
  if (docs) {
    type.description = docs;
  }

  const subType = getPropType(argumentPath, importer);

  // @ts-ignore
  if (subType.name === 'unknown') {
    type.value = printValue(argumentPath);
    type.computed = true;
  } else {
    type.value = subType;
  }
  return type;
}

/**
 * Handles shape and exact prop types
 */
function getPropTypeShapish(
  name: 'shape' | 'exact',
  argumentPath: NodePath,
  importer: Importer,
) {
  const type: PropTypeDescriptor = { name };
  if (!t.ObjectExpression.check(argumentPath.node)) {
    argumentPath = resolveToValue(argumentPath, importer);
  }

  if (t.ObjectExpression.check(argumentPath.node)) {
    const value = {};
    argumentPath.get('properties').each(function (propertyPath) {
      // @ts-ignore
      if (propertyPath.get('type').value === t.SpreadElement.name) {
        // It is impossible to resolve a name for a spread element
        return;
      }

      const propertyName = getPropertyName(propertyPath, importer);
      if (!propertyName) return;
      const descriptor: PropDescriptor | PropTypeDescriptor = getPropType(
        propertyPath.get('value'),
        importer,
      );
      const docs = getDocblock(propertyPath);
      if (docs) {
        descriptor.description = docs;
      }
      descriptor.required = isRequiredPropType(propertyPath.get('value'));
      value[propertyName] = descriptor;
    });
    type.value = value;
  }

  if (!type.value) {
    type.value = printValue(argumentPath);
    type.computed = true;
  }

  return type;
}

function getPropTypeInstanceOf(
  argumentPath: NodePath,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _importer: Importer,
): PropTypeDescriptor {
  return {
    name: 'instanceOf',
    value: printValue(argumentPath),
  };
}

const simplePropTypes = [
  'array',
  'bool',
  'func',
  'number',
  'object',
  'string',
  'any',
  'element',
  'node',
  'symbol',
  'elementType',
] as const;

const propTypes = new Map<
  string,
  (path: NodePath, importer: Importer) => PropTypeDescriptor
>([
  ['oneOf', getPropTypeOneOf],
  ['oneOfType', getPropTypeOneOfType],
  ['instanceOf', getPropTypeInstanceOf],
  ['arrayOf', getPropTypeArrayOf],
  ['objectOf', getPropTypeObjectOf],
  ['shape', getPropTypeShapish.bind(null, 'shape')],
  ['exact', getPropTypeShapish.bind(null, 'exact')],
]);

/**
 * Tries to identify the prop type by inspecting the path for known
 * prop type names. This method doesn't check whether the found type is actually
 * from React.PropTypes. It simply assumes that a match has the same meaning
 * as the React.PropTypes one.
 *
 * If there is no match, "custom" is returned.
 */
export default function getPropType(
  path: NodePath,
  importer: Importer,
): PropTypeDescriptor {
  let descriptor: PropTypeDescriptor | null = null;
  getMembers(path, true).some(member => {
    const node = member.path.node;
    let name: string | null = null;
    if (t.Literal.check(node)) {
      name = node.value as string;
    } else if (t.Identifier.check(node) && !member.computed) {
      name = node.name;
    }
    if (name) {
      if (simplePropTypes.includes(name as typeof simplePropTypes[number])) {
        descriptor = { name: name as typeof simplePropTypes[number] };
        return true;
      } else if (propTypes.has(name) && member.argumentsPath) {
        // @ts-ignore
        descriptor = propTypes.get(name)(member.argumentsPath.get(0), importer);
        return true;
      }
    }

    return;
  });
  if (!descriptor) {
    const node = path.node;
    if (
      t.Identifier.check(node) &&
      simplePropTypes.includes(node.name as typeof simplePropTypes[number])
    ) {
      descriptor = { name: node.name as typeof simplePropTypes[number] };
    } else if (
      t.CallExpression.check(node) &&
      t.Identifier.check(node.callee) &&
      propTypes.has(node.callee.name)
    ) {
      // @ts-ignore
      descriptor = propTypes.get(node.callee.name)(path.get('arguments', 0));
    } else {
      descriptor = { name: 'custom', raw: printValue(path) };
    }
  }
  return descriptor;
}
