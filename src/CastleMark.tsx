/** Scalable crown-and-C brand mark, based on the supplied Castle reference. */
export default function CastleMark(){
 return <img className="castle-mark" src={`${import.meta.env.BASE_URL}castle-mark.svg`} alt="" aria-hidden="true" width="40" height="40"/>;
}
