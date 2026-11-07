/**
 * Entrada pública del módulo fiscal (ADR-001): los demás módulos solo importan de acá. Lo que se exporta vive
 * en `superficie/`, partido por tema para que ningún archivo pase de 400 líneas; los nombres exportados son los
 * mismos de siempre. Un nombre repetido entre dos partes no compila (TS2308): no hay forma de pisar uno en silencio.
 */
export * from "./superficie/dominio";
export * from "./superficie/persistencia";
export * from "./superficie/numeracion";
export * from "./superficie/consultas";
export * from "./superficie/facturacion";
export * from "./superficie/certificados-y-configuracion";
