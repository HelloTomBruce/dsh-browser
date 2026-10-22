/** 页内 walker 核心(自包含;勿引用模块级变量、勿导入任何模块)。 */
declare function __walkerCore(): {
    INTERACTIVE: Set<string>;
    STRUCTURAL: Set<string>;
    SKIP_TAGS: Set<string>;
    roleOf: (el: Element) => string;
    nameOf: (el: Element, role: string) => string;
    cssPath: (el: Element) => string;
    isVisible: (el: Element) => boolean;
    isElementInViewport: (el: Element, padding?: number) => boolean;
    describeElement: (el: Element) => {
        role: string;
        name: string;
        selector: string;
        testid: string;
        id: string;
        tag: string;
        text: string;
        visible: boolean;
    };
};
/** walker 核心注入后暴露给 entry 的 API(类型层)。 */
export type WalkerApi = ReturnType<typeof __walkerCore>;
/**
 * 把消费方 entry(自包含函数,签名 (payload, w: WalkerApi) => R)拼装成
 * 可被 page.evaluate 序列化的独立函数 (payload: P) => R。
 * 拼装发生在模块加载期(new Function 一次性),调用期零开销。
 */
export declare function injectWalker<P, R>(entry: (payload: P, w: WalkerApi) => R): (payload: P) => R;
export {};
//# sourceMappingURL=walker.d.ts.map