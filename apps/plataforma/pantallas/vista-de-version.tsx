import { Insignia } from "../../web/ui/componentes/Insignia";
import { SoloLector } from "../../web/ui/primitivas/SoloLector";
import {
  lineasDeDiferencia,
  modulosParaElegir,
  perillasParaElegir,
  textoDelValor,
  valorDe,
  conLoQueSePide,
} from "../logica/editor-de-plan";
import { textoDePlanes } from "../logica/textos-de-planes";
import type { FichaVista, VersionVista } from "../logica/vista-de-planes";
import type { ClienteDeVersion } from "../servidor/planes";
import estilos from "./empresas.module.css";
import propios from "./planes.module.css";

/** Una versión publicada: solo lectura (módulos, perillas con su origen, motivo, quién y cuándo, qué cambió y qué clientes la usan). Ningún control de edición. */
export function VistaDeVersion({
  ficha,
  version,
  clientes,
}: Readonly<{ ficha: FichaVista; version: VersionVista; clientes: readonly ClienteDeVersion[] }>) {
  const incluidos = conLoQueSePide(version.modulos);
  const anterior = ficha.publicadas.find((v) => v.numero === (version.numero ?? 0) - 1);
  const cambios = anterior === undefined ? [] : lineasDeDiferencia(anterior, version);
  return (
    <>
      <p className={propios["migas"]}>
        <a className={estilos["enlaceSimple"]} href="/planes">
          {textoDePlanes("plataforma.planes.titulo")}
        </a>{" "}
        /{" "}
        <a className={estilos["enlaceSimple"]} href={`/planes/${encodeURIComponent(ficha.id)}`}>
          {ficha.codigo}
        </a>{" "}
        / v{version.numero}
      </p>
      <div className={propios["acciones"]}>
        <Insignia tono="exito">{textoDePlanes("plataforma.planes.version_publicada")}</Insignia>
        <span>
          {textoDePlanes("plataforma.planes.publicada_por", {
            nombre: version.nombreComercial,
            fecha: version.publicadaEn ?? "—",
            quien: version.publicadaPor ?? "—",
          })}
        </span>
      </div>
      <p>
        {textoDePlanes("plataforma.planes.motivo_de", { motivo: version.motivo ?? "—" })}.{" "}
        {textoDePlanes("plataforma.planes.version_inmutable")}
      </p>
      <section className={propios["seccion"]} aria-labelledby="titulo-de-modulos">
        <h2 id="titulo-de-modulos">{textoDePlanes("plataforma.planes.modulos")}</h2>
        <table className={estilos["tabla"]}>
          <caption>
            <SoloLector>{textoDePlanes("plataforma.planes.modulos")}</SoloLector>
          </caption>
          <thead>
            <tr>
              <th scope="col">{textoDePlanes("plataforma.planes.col_modulo")}</th>
              <th scope="col">{textoDePlanes("plataforma.planes.col_incluido")}</th>
            </tr>
          </thead>
          <tbody>
            {modulosParaElegir().map((m) => (
              <tr key={m.clave}>
                <th scope="row" className={estilos["nombre"]}>
                  {m.rotulo}
                </th>
                <td>
                  <span className={estilos["rotulo"]}>
                    {textoDePlanes("plataforma.planes.col_incluido")}
                  </span>
                  <span>
                    {textoDePlanes(
                      incluidos.includes(m.clave) ? "plataforma.planes.si" : "plataforma.planes.no",
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className={propios["seccion"]} aria-labelledby="titulo-de-perillas">
        <h2 id="titulo-de-perillas">{textoDePlanes("plataforma.planes.perillas")}</h2>
        <table className={estilos["tabla"]}>
          <caption>
            <SoloLector>{textoDePlanes("plataforma.planes.perillas")}</SoloLector>
          </caption>
          <thead>
            <tr>
              <th scope="col">{textoDePlanes("plataforma.planes.col_perilla")}</th>
              <th scope="col">{textoDePlanes("plataforma.planes.col_valor")}</th>
              <th scope="col">{textoDePlanes("plataforma.planes.col_origen")}</th>
            </tr>
          </thead>
          <tbody>
            {perillasParaElegir().map((p) => (
              <tr key={p.clave}>
                <th scope="row" className={estilos["nombre"]}>
                  {p.rotulo}
                </th>
                <td>
                  <span className={estilos["rotulo"]}>
                    {textoDePlanes("plataforma.planes.col_valor")}
                  </span>
                  <span>{textoDelValor(valorDe(version.perillas, p.clave))}</span>
                </td>
                <td>
                  <span className={estilos["rotulo"]}>
                    {textoDePlanes("plataforma.planes.col_origen")}
                  </span>
                  <span>
                    {textoDePlanes(
                      Object.hasOwn(version.perillas, p.clave)
                        ? "plataforma.planes.origen_plan"
                        : "plataforma.planes.origen_base",
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {anterior === undefined ? null : (
        <section className={propios["seccion"]} aria-labelledby="titulo-de-cambios">
          <h2 id="titulo-de-cambios">
            {textoDePlanes("plataforma.planes.que_cambio", { n: anterior.numero ?? 0 })}
          </h2>
          {cambios.length === 0 ? (
            <p>{textoDePlanes("plataforma.planes.sin_cambios")}</p>
          ) : (
            <ul>
              {cambios.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
        </section>
      )}
      <section className={propios["seccion"]} aria-labelledby="titulo-de-clientes">
        <h2 id="titulo-de-clientes">{textoDePlanes("plataforma.planes.clientes_con_version")}</h2>
        {clientes.length === 0 ? (
          <p>{textoDePlanes("plataforma.planes.sin_clientes")}</p>
        ) : (
          <ul>
            {clientes.map((c) => (
              <li key={c.id}>{c.nombre}</li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
