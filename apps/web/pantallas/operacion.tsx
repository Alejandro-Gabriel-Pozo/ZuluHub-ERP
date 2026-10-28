import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import type { ClaveDeTexto } from "../../../src/capacidades/vocabulario/catalogo";
import { texto } from "../../../src/capacidades/vocabulario/vocabulario";
import { empresaDelPedido } from "../servidor/sesion";
import { destinosDeModulos } from "../servidor/modulos";
import { ArmazonDeOperacion, type DestinoActual } from "../ui/plantillas/sesion/ArmazonDeOperacion";
import type { EmpresaParaMostrar } from "../ui/plantillas/sesion/textos-de-empresa";
import { PantallaDeErrorDeEntrada } from "./errores";

export type DatosDeLaEmpresaActiva = Readonly<{
  empresa: EmpresaParaMostrar;
  /** Para llamar a los casos de uso y consultas de la empresa. Solo existe en el servidor. */
  contexto: ContextoOperativo;
}>;

/**
 * Contenido cuyo título (el único `h1`) solo se conoce al leer los datos, como el «Factura B 00001-00001234» del
 * detalle. Previene: dos títulos en la pantalla (el genérico del armazón y el real como `h2`). Chequeo:
 * `test/web/operacion-titulo.test.ts` (renderiza `pantallaDeOperacion` de verdad: un solo `h1`, el real) y
 * `test/web/detalle-pagina.test.ts` (la página del detalle sobre esa misma función).
 */
export type ContenidoConTitulo = Readonly<{ tituloResuelto: string; cuerpo: ReactNode }>;

export const conTitulo = (tituloResuelto: string, cuerpo: ReactNode): ContenidoConTitulo => ({
  tituloResuelto,
  cuerpo,
});

const esConTitulo = (c: ReactNode | ContenidoConTitulo): c is ContenidoConTitulo =>
  typeof c === "object" && c !== null && "tituloResuelto" in c;

/**
 * Una pantalla del mostrador: resuelve sesión, marca del host y empresa (con la cookie `pd_empresa` validada),
 * y si todo está bien la pinta dentro del armazón de operación. Si no hay empresa elegida, manda a elegirla; si
 * la cookie es de otra marca (o de una empresa que ya no es de la persona), «sin permiso». CADA página lo llama
 * (no solo el layout): al navegar de una página a otra Next no vuelve a correr el layout. El título es la clave del
 * catálogo; si el contenido devuelve `conTitulo(...)`, manda ese texto ya resuelto.
 */
export async function pantallaDeOperacion(
  opciones: Readonly<{ titulo: ClaveDeTexto; actual?: DestinoActual }>,
  contenido: (
    datos: DatosDeLaEmpresaActiva,
  ) => ReactNode | ContenidoConTitulo | Promise<ReactNode | ContenidoConTitulo>,
): Promise<ReactNode> {
  const { puerta, entrada } = await empresaDelPedido();
  if (!entrada.ok) return <PantallaDeErrorDeEntrada error={entrada.error} />;
  if (entrada.dato.tipo !== "ENTRA") redirect("/empresa");
  const { empresa, contexto } = entrada.dato;
  const resultado = await contenido({ empresa, contexto });
  const titulado = esConTitulo(resultado);
  return (
    <ArmazonDeOperacion
      titulo={titulado ? resultado.tituloResuelto : texto({}, opciones.titulo)}
      {...(opciones.actual === undefined ? {} : { actual: opciones.actual })}
      marca={puerta.marca.nombre}
      empresa={empresa.nombre}
      modulos={destinosDeModulos()}
    >
      {titulado ? resultado.cuerpo : resultado}
    </ArmazonDeOperacion>
  );
}
