/**
 * Los tipos de `pdfkit` 0.20.2 que usa el adaptador de PDF, y nada más. El paquete no trae tipos propios y `@types/pdfkit` no es una
 * dependencia aprobada: se declara acá lo que se usa (y se prueba con el PDF real), así que usar algo que no está declarado no compila.
 * Previene: `any` implícito en el único lugar que toca la librería. Chequeo: `pdf-de-la-factura.test.ts` corre estas llamadas de verdad.
 */
declare module "pdfkit" {
  interface OpcionesDeTexto {
    width?: number;
    align?: "left" | "center" | "right";
    continued?: boolean;
    lineGap?: number;
    lineBreak?: boolean;
  }

  interface OpcionesDelDocumento {
    size?: readonly [number, number];
    margin?: number;
    autoFirstPage?: boolean;
    compress?: boolean;
    info?: Readonly<{ Title?: string; CreationDate?: Date; ModDate?: Date }>;
  }

  export default class PDFDocument {
    constructor(opciones?: OpcionesDelDocumento);
    on(evento: "data", escuchar: (trozo: Uint8Array) => void): this;
    on(evento: "end", escuchar: () => void): this;
    on(evento: "error", escuchar: (error: Error) => void): this;
    addPage(opciones?: Readonly<{ size?: readonly [number, number]; margin?: number }>): this;
    font(nombre: string): this;
    fontSize(tamano: number): this;
    fillColor(color: string): this;
    strokeColor(color: string): this;
    lineWidth(grosor: number): this;
    text(texto: string, x: number, y: number, opciones?: OpcionesDeTexto): this;
    text(texto: string, opciones?: OpcionesDeTexto): this;
    heightOfString(texto: string, opciones?: OpcionesDeTexto): number;
    widthOfString(texto: string, opciones?: OpcionesDeTexto): number;
    currentLineHeight(conInterlineado?: boolean): number;
    rect(x: number, y: number, ancho: number, alto: number): this;
    moveTo(x: number, y: number): this;
    lineTo(x: number, y: number): this;
    fill(color?: string): this;
    stroke(color?: string): this;
    end(): void;
  }
}
