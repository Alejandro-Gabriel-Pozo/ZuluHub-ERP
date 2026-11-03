import type { ReactNode } from "react";
import { Aviso } from "../../componentes/Aviso";
import { Texto } from "../../primitivas/Texto";
import { MigasDeConfiguracion, type TramoDeMigas } from "./MigasDeConfiguracion";
import type { LecturaDeDatosFiscales } from "./modelo-de-datos-fiscales";
import estilos from "./PantallaDeDatosFiscales.module.css";

/** Las filas de «rótulo y valor» de lo que rige (también el CUIT del formulario, que es solo para leer). */
export function DatosParaLeer({ filas }: Readonly<{ filas: LecturaDeDatosFiscales["filas"] }>) {
  return (
    <dl className={estilos["datos"]}>
      {filas.map((fila) => (
        <div key={fila.rotulo} className={estilos["dato"]}>
          <dt className={estilos["rotulo"]}>{fila.rotulo}</dt>
          <dd className={estilos["valor"]}>{fila.valor}</dd>
        </div>
      ))}
    </dl>
  );
}

export type PropsDePantallaDeDatosFiscales = Readonly<{
  migas: readonly TramoDeMigas[];
  lectura: LecturaDeDatosFiscales;
  /** «Hay un borrador sin confirmar.» y su detalle, cuando ya hay uno (D-68); `null`: no hay. */
  aviso: Readonly<{ titulo: string; detalle: string }> | null;
  /** «Corregir» o «Seguir con el borrador». */
  accion: ReactNode;
}>;

/**
 * Datos fiscales, primero lo vigente (opción A, aprobada por el dueño el 2026-10-29): solo para leer, con el CUIT de la empresa
 * (D-65) y desde cuándo rige. Con un borrador sin confirmar (de otra persona o de otro dispositivo, D-68) dice que lo hay y la acción
 * es seguir con él; sin borrador, «Corregir».
 */
export function PantallaDeDatosFiscales({
  migas,
  lectura,
  aviso,
  accion,
}: PropsDePantallaDeDatosFiscales) {
  return (
    <div className={estilos["raiz"]}>
      <MigasDeConfiguracion tramos={migas} />
      {aviso === null ? null : (
        <Aviso tono="info" titulo={aviso.titulo}>
          {aviso.detalle}
        </Aviso>
      )}
      <DatosParaLeer filas={lectura.filas} />
      <Texto variante="suave">{lectura.rigeDesde}</Texto>
      <div>{accion}</div>
    </div>
  );
}
