/// <reference types="vite/client" />
/// <reference types="@testing-library/jest-dom/vitest" />

declare module '*.jsx' {
	import type { ComponentType } from 'react';
	const Component: ComponentType<any>;
	export default Component;
}

declare module '*.png' {
	const src: string;
	export default src;
}
