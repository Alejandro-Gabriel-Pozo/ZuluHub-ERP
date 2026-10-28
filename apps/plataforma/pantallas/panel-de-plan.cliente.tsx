import { Aviso } from "../../web/ui/componentes/Aviso";
import { Insignia } from "../../web/ui/componentes/Insignia";
import { SoloLector } from "../../web/ui/primitivas/SoloLector";
import { Texto } from "../../web/ui/primitivas/Texto";
import type { PlanDeEmpresa } from "../logica/plan-de-empresa";
import {
  textoDeEmpresasDelCliente,
  rotuloDeEstadoDeModulo,
  rotuloDeModulo,
  rotuloDeOrigen,
  rotuloDePerilla,
  textoDeValor,
} from "../logica/plan";
import { fechaArgentinaDeInstante, fechaLegible } from "../logica/vigencia";
import { CambioDePlan } from "./cambio-de-plan.cliente";
import estilos from "./empresas.module.css";
import propios from "./plan.module.css";

export type PropsDePanelDePlan = Readonly<{ plan: PlanDeEmpresa }>;

/** De un instante ISO al día argentino 'AAAA-MM-DD' que entiende `fechaLegible`. */
const soloFecha = fechaArgentinaDeInstante;

/**
 * La sección «Plan» de una empresa: plan actual, límites y módulos. Sin estado propio (se arma en el servidor);
 * solo el cambio de plan es interactivo. No se muestra el uso de usuarios ni de sucursales: el backend no lo conoce.
 */
export function PanelDePlan({ plan }: PropsDePanelDePlan) {
  const { planActual, programada, empresasDelCliente } = plan;
  return (
    <div className={propios["panel"]}>
      <section className={propios["seccion"]} aria-labelledby="plan-actual">
        <h2 id="plan-actual" className={propios["subtitulo"]}>
          Plan actual
        </h2>
        {plan.sinPlan || planActual === null ? (
          <Aviso tono="aviso">
            <Texto>
              Esta empresa todavía no tiene un plan asignado: rigen solo los módulos obligatorios y
              los valores base.
            </Texto>
          </Aviso>
        ) : (
          <div className={propios["actual"]}>
            <Texto variante="subtitulo">{planActual.nombreComercial}</Texto>
            <Texto>
              Versión {planActual.versionNumero}, vigente desde{" "}
              {fechaLegible(soloFecha(planActual.vigenteDesde))}.
            </Texto>
          </div>
        )}
        {programada === null ? null : (
          <Aviso tono="info">
            <Texto>
              Hay un cambio programado: {programada.nombreComercial} versión{" "}
              {programada.versionNumero} desde {fechaLegible(soloFecha(programada.vigenteDesde))}.
            </Texto>
          </Aviso>
        )}
        <CambioDePlan plan={plan} />
      </section>

      <section className={propios["seccion"]} aria-labelledby="plan-limites">
        <h2 id="plan-limites" className={propios["subtitulo"]}>
          Límites
        </h2>
        <table className={estilos["tabla"]}>
          <caption>
            <SoloLector>Límites de la empresa</SoloLector>
          </caption>
          <thead>
            <tr>
              <th scope="col">Límite</th>
              <th scope="col">Valor</th>
              <th scope="col">Origen</th>
            </tr>
          </thead>
          <tbody>
            {plan.perillas.map((perilla) => (
              <tr key={perilla.perilla}>
                <th scope="row" className={estilos["nombre"]}>
                  {rotuloDePerilla(perilla.perilla)}
                </th>
                <td>
                  <span className={estilos["rotulo"]}>Valor</span>
                  <span>{textoDeValor(perilla.valor)}</span>
                </td>
                <td>
                  <span className={estilos["rotulo"]}>Origen</span>
                  <span>{rotuloDeOrigen(perilla.origen)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Texto>{textoDeEmpresasDelCliente(empresasDelCliente)}</Texto>
        <p className={propios["nota"]}>
          El uso de usuarios y sucursales no se ve desde la consola.
        </p>
      </section>

      <section className={propios["seccion"]} aria-labelledby="plan-modulos">
        <h2 id="plan-modulos" className={propios["subtitulo"]}>
          Módulos
        </h2>
        <table className={estilos["tabla"]}>
          <caption>
            <SoloLector>Módulos de la empresa</SoloLector>
          </caption>
          <thead>
            <tr>
              <th scope="col">Módulo</th>
              <th scope="col">Incluido en el plan</th>
              <th scope="col">Estado</th>
            </tr>
          </thead>
          <tbody>
            {plan.modulos.map((modulo) => {
              const estado = modulo.disponible
                ? rotuloDeEstadoDeModulo(modulo.estado)
                : { texto: "En desarrollo", tono: "info" as const };
              return (
                <tr key={modulo.modulo}>
                  <th scope="row" className={estilos["nombre"]}>
                    {rotuloDeModulo(modulo.modulo)}
                  </th>
                  <td>
                    <span className={estilos["rotulo"]}>Incluido en el plan</span>
                    <span>{modulo.habilitadoPorElPlan ? "Sí" : "No"}</span>
                  </td>
                  <td>
                    <span className={estilos["rotulo"]}>Estado</span>
                    <span>
                      <Insignia tono={estado.tono}>{estado.texto}</Insignia>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
