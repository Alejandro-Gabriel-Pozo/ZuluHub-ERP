import { useId } from "react";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Boton } from "../../componentes/Boton.cliente";
import type { CobroVisto } from "./modelo-del-cierre";
import estilos from "./PantallaDelCierre.module.css";

/** «Cobros»: cada uno con su importe, quién lo registró, el medio vigente y, si se corrigió, quién y por qué. Con el día en cierre cada uno ofrece «Corregir medio». */
export function ListaDeCobros({
  cobros,
  editable,
  alCorregir,
}: Readonly<{
  cobros: readonly CobroVisto[];
  editable: boolean;
  alCorregir: (cobro: CobroVisto) => void;
}>) {
  return (
    <ul className={estilos["lista"]}>
      {cobros.map((cobro) => (
        <TarjetaDeCobro
          key={cobro.cobroId}
          cobro={cobro}
          editable={editable}
          alCorregir={alCorregir}
        />
      ))}
    </ul>
  );
}

function TarjetaDeCobro({
  cobro,
  editable,
  alCorregir,
}: Readonly<{ cobro: CobroVisto; editable: boolean; alCorregir: (cobro: CobroVisto) => void }>) {
  const idDelImporte = useId();
  return (
    <li className={estilos["item"]}>
      <div role="group" aria-labelledby={idDelImporte} className={estilos["tarjeta"]}>
        <div className={estilos["renglon"]}>
          <span>
            <strong id={idDelImporte} className={estilos["monto"]}>
              {cobro.importe}
            </strong>
            {cobro.registradoPor === null ? null : (
              <span className={estilos["suave"]}> · {cobro.registradoPor}</span>
            )}
          </span>
          {editable ? (
            <Boton
              variante="secundaria"
              deshabilitado={!cobro.puedeCorregir}
              alTocar={() => {
                alCorregir(cobro);
              }}
            >
              {texto({}, "cierre.corregir_medio")}
            </Boton>
          ) : null}
        </div>
        <span>{cobro.medio}</span>
        {cobro.corregidoPor === null ? null : (
          <span className={estilos["suave"]}>{cobro.corregidoPor}</span>
        )}
        {cobro.motivo === null ? null : <span className={estilos["suave"]}>{cobro.motivo}</span>}
      </div>
    </li>
  );
}
