/* Loose ambient stubs so `tsc -p tsconfig.check.json` can type-check our own code in an environment without node_modules. */
declare module "react" { const React: any; export default React; export const useState: any; export const useEffect: any; export const useRef: any; export const useTransition: any; export type ReactNode = any; }
declare namespace React { type ReactNode = any; }
declare namespace JSX { interface IntrinsicElements { [k: string]: any } interface Element {} }
declare module "next/link" { const Link: any; export default Link; }
declare module "next/navigation" { export const redirect: (u: string) => never; export const notFound: () => never; export const useRouter: any; export const usePathname: any; }
declare module "next/headers" { export const cookies: () => Promise<any>; }
declare module "next/server" { export class NextResponse { static json(b: any, i?: any): any; constructor(b?: any, i?: any); } }
declare module "next" { export type Metadata = any; export type NextConfig = any; }
declare module "next-intl" { export const useTranslations: (ns?: string) => ((k: string, v?: any) => string); export const useLocale: () => string; export const NextIntlClientProvider: any; }
declare module "next-intl/server" { export const getTranslations: (ns?: string) => Promise<(k: string, v?: any) => string>; export const getLocale: () => Promise<string>; export const getMessages: () => Promise<any>; export const getRequestConfig: any; }
declare module "next-intl/plugin" { const f: any; export default f; }
declare module "qrcode" { const q: { toDataURL: (s: string, o?: any) => Promise<string> }; export default q; }
declare module "zod" { export const z: any; export namespace z { type infer<T> = any; } }
declare module "vitest" { export const describe: any; export const it: any; export const expect: any; }
declare module "@prisma/client" { export class PrismaClient { constructor(o?: any); [k: string]: any; } export namespace Prisma { type InputJsonValue = any; type TransactionClient = any; } export type AssetStatus = string; export type AssetEventType = string; export type ServiceOrderStatus = string; }
declare module "*.json" { const v: any; export default v; }
declare module "*.css";
