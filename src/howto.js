// Plain-language "what you'll need" and steps for the standard tasks. General guidance only: your owner's manual
// or the product's instructions always win. Keyed by the task title without any " — vehicle" or "(season)" part.
// q: what to search for. specs: vehicle specs worth showing. links: trusted pages (checked when written).
const READY = "https://www.ready.gov";
export const SOURCES = {
  kit: { label: "Ready.gov: build a supplies kit", url: `${READY}/kit` },
  water: { label: "Ready.gov: emergency water", url: `${READY}/water` },
  car: { label: "Ready.gov: car safety and kits", url: `${READY}/car` },
  fire: { label: "Ready.gov: home fire safety", url: `${READY}/home-fires` },
  smoke: { label: "NFPA: smoke alarms", url: "https://www.nfpa.org/education-and-research/home-fire-safety/smoke-alarms" },
  extinguisher: { label: "NFPA: fire extinguishers", url: "https://www.nfpa.org/education-and-research/home-fire-safety/fire-extinguishers" },
  co: { label: "CPSC: carbon monoxide safety", url: "https://www.cpsc.gov/Safety-Education/Safety-Education-Centers/Carbon-Monoxide-Information-Center" },
  tires: { label: "NHTSA: tire safety", url: "https://www.nhtsa.gov/vehicle-safety/tires" },
};

export const HOWTO = {
  // ---------------- car ----------------
  "oil change": {
    q: "change oil", specs: ["oilType", "oilCapacity", "oilFilter"],
    need: ["The oil type and amount from your manual", "A new oil filter", "Drain pan, socket or wrench for the drain plug, oil filter wrench", "Funnel, gloves and rags", "Jack stands or ramps (never work under a car held only by a jack)"],
    steps: ["Warm the engine for a few minutes, then turn it off.", "Raise the front of the car on level ground and support it securely.", "Drain the oil into the pan, then remove the old filter.", "Wipe a thin film of new oil on the new filter's rubber gasket and tighten it by hand.", "Refit the drain plug (new washer if yours needs one) and add the new oil.", "Check the dipstick, run the engine a minute, then look for leaks and recheck the level.", "Take the old oil and filter to an auto parts store or recycling center."],
    tip: "When you tap Done, enter the odometer so the next oil change is timed from this one.",
  },
  "rotate tires": {
    q: "rotate tires", specs: ["tireSize", "tirePsi"],
    need: ["Jack, jack stands and a lug wrench", "Torque wrench (lug nut torque is in your manual)", "Tire pressure gauge"],
    steps: ["Loosen the lug nuts a little while the wheels are on the ground.", "Lift and support the car, then remove the wheels.", "Swap them in the pattern your manual shows (it depends on front, rear or all-wheel drive, and on the tire type).", "Hand-tighten the lug nuts in a star pattern, lower the car, then torque them to spec.", "Set each tire to the correct pressure.", "Recheck the lug nut torque after about 50 miles."],
    tip: "Look at the tread while the wheels are off. Uneven wear can point to an alignment problem.",
    links: ["tires"],
  },
  "check tire pressure": {
    q: "check tire pressure", specs: ["tirePsi", "tireSize"],
    need: ["A tire pressure gauge", "An air source (home compressor or gas station)"],
    steps: ["Check when the tires are cold: before driving, or after the car sat a few hours.", "Use the pressure on the sticker inside the driver's door, not the maximum printed on the tire.", "Press the gauge on the valve, read it, and add or release air to match.", "Do the spare too if you have one."],
    tip: "Pressure drops about 1 psi for every 10°F colder, so check more often in fall.",
    links: ["tires"],
  },
  "replace engine air filter": {
    q: "replace engine air filter", specs: ["airFilter"],
    need: ["The right filter (the part number is in your manual or at the parts store)"],
    steps: ["Open the air box (clips or a few screws).", "Note which way the old filter faces, then lift it out.", "Wipe out any debris in the box.", "Drop in the new filter the same way and close the box fully."],
  },
  "replace cabin air filter": {
    q: "replace cabin air filter", specs: ["cabinFilter"],
    need: ["The right cabin filter for your model"],
    steps: ["It is usually behind the glove box: empty it and unhook or unclip it so it swings down.", "Open the filter door and slide the old filter out, noticing the airflow arrow.", "Slide the new one in with the arrow pointing the same way.", "Close the door and the glove box."],
  },
  "replace wiper blades": {
    q: "replace wiper blades", specs: ["wiperSizes"],
    need: ["Blades in the right sizes (the driver and passenger sides are often different)"],
    steps: ["Lift the wiper arm away from the glass.", "Press the small tab or button and slide the old blade off the hook.", "Slide the new blade on until it clicks.", "Lower the arm gently so it doesn't snap onto the glass."],
    tip: "Put a towel under the arm so it can't crack the windshield if it slips.",
  },
  "check brakes and brake fluid": {
    q: "inspect brakes and check brake fluid",
    need: ["Flashlight"],
    steps: ["Listen for squealing or grinding, and notice a soft pedal or longer stopping distance.", "Look through the wheel spokes at the brake pad: if the pad looks thinner than about 1/8 inch, it is due.", "Find the brake fluid reservoir under the hood and check the level is between the marks.", "Dark or dirty fluid means it is time for a fluid change."],
    tip: "Brakes are a safety system. If anything seems off, have a shop inspect them.",
  },
  "test battery and clean terminals": {
    q: "test car battery and clean terminals", specs: ["batterySize"],
    need: ["Safety glasses and gloves", "Terminal brush, baking soda and water", "A wrench that fits the terminals"],
    steps: ["Turn the car off. Look for white or blue crust on the terminals.", "Disconnect the negative (black) cable first, then the positive.", "Scrub the posts and clamps with baking soda and water on the brush; dry them.", "Reconnect the positive first, then the negative, and snug them down.", "Most auto parts stores will load-test the battery for free; ask them to."],
    tip: "Batteries commonly last 3 to 5 years. A date sticker or code on the case shows its age.",
  },
  "check coolant and fluid levels": {
    q: "check car fluid levels", specs: ["coolantType"],
    need: ["Rag and a flashlight", "The right fluids if you need to top up"],
    steps: ["Park on level ground with the engine cool. Never open a hot radiator cap.", "Check the coolant reservoir sits between the MIN and MAX marks.", "Check washer fluid, power steering fluid (if your car has it) and brake fluid against their marks.", "Top up only with the type your manual lists."],
  },
  "replace coolant": {
    q: "coolant flush", specs: ["coolantType"],
    need: ["The coolant type from your manual"],
    steps: ["This is a job many people leave to a shop. Coolant is poisonous to pets and has to be recycled.", "If you do it yourself, work with the engine cold and follow your manual's drain and refill steps.", "Bleed any trapped air as your manual describes."],
  },
  "service transmission fluid": {
    q: "transmission fluid service",
    need: ["Your owner's manual to see if your transmission is serviceable"],
    steps: ["Many modern transmissions are sealed and need a shop with the right fluid and equipment.", "Ask the shop for the exact fluid your car requires, and don't mix types."],
  },
  "inspect trailer tires and lug nuts": {
    q: "inspect trailer tires and lug nuts", links: ["tires"],
    need: ["Tire gauge, torque wrench"],
    steps: ["Check pressure against the number on the trailer or tire.", "Look for cracks, bulges and uneven wear.", "Torque the lug nuts to the trailer's spec."],
  },
  "grease trailer wheel bearings": {
    q: "grease trailer wheel bearings",
    need: ["Bearing grease, new seals, basic hand tools"],
    steps: ["Jack up and support the trailer, then remove the wheel and hub.", "Clean and inspect the bearings, and replace any that are pitted or discolored.", "Repack them with grease, fit new seals, and reassemble."],
    tip: "If you've never done this, have a shop show you the first time.",
  },
  "test trailer lights and brakes": {
    q: "test trailer lights and brakes",
    need: ["A helper to watch the lights"],
    steps: ["Connect the trailer, then check running lights, turn signals and brake lights while someone watches.", "Test the brake controller at a low speed in a safe place."],
  },
  "check trailer hitch and safety chains": {
    q: "inspect trailer hitch and safety chains",
    need: ["A flashlight and a rag"],
    steps: ["Check the coupler, ball and pin for wear and cracks.", "Check the safety chains and the breakaway cable for rust or damaged links.", "Make sure the coupler latches fully and the ball size matches."],
  },

  // ---------------- house ----------------
  "replace hvac filter": {
    q: "replace furnace air filter",
    need: ["A new filter in the right size (it's printed on the edge of the old one)"],
    steps: ["Turn the system off.", "Slide out the old filter and note the arrow showing the airflow direction.", "Slide in the new one with the arrow pointing the same way (toward the blower).", "Write the date on the frame and turn the system back on."],
    tip: "Check it monthly if you have pets or dust. A clogged filter strains the system.",
  },
  "test smoke and co detectors": {
    q: "test smoke and carbon monoxide alarms", links: ["smoke", "co"],
    need: ["A step stool"],
    steps: ["Press and hold the test button on each alarm until it sounds.", "Replace the batteries in any that chirp or are weak.", "Check the date on the back: replace smoke alarms about every 10 years, and CO alarms by the date on the label."],
  },
  "flush water heater": {
    q: "flush water heater",
    need: ["Garden hose and a bucket"],
    steps: ["Turn off the power at the breaker (electric) or set the gas control to pilot (gas).", "Close the cold water inlet and open a hot tap in the house.", "Run the hose from the drain valve to a floor drain or outside and open the valve.", "Drain until the water runs clear, then close the valve.", "Open the cold inlet and let the tank refill until water flows steadily from the hot tap, then turn the power or gas back on."],
    tip: "Never turn an electric heater on while the tank is empty. The water is hot enough to scald, so take care. If the drain valve is stuck or leaks, call a plumber.",
  },
  "test gfci outlets": {
    q: "test GFCI outlets",
    need: ["A lamp or phone charger to check the outlet has power"],
    steps: ["Plug in a lamp, press TEST: the power should cut off and the button pop out.", "Press RESET: the power should come back.", "If it doesn't trip or won't reset, replace the outlet or call an electrician."],
  },
  "clean dryer vent": {
    q: "clean dryer vent", links: ["fire"],
    need: ["A vent brush kit or a vacuum with a long hose"],
    steps: ["Unplug the dryer (and close the gas valve if it is gas), then pull it out from the wall.", "Disconnect the duct and clean the lint out of it and out of the dryer's outlet.", "Clean the vent hood outside and make sure the flap opens freely.", "Reconnect with a metal duct, not thin foil or plastic, and push the dryer back without crushing the duct."],
    tip: "Clean the lint screen after every load too.",
  },
  "check fire extinguishers": {
    q: "check fire extinguisher", links: ["extinguisher"],
    need: ["None"],
    steps: ["The gauge needle should be in the green.", "The safety pin and seal should be in place and the hose and nozzle undamaged.", "Check the label for the replacement or service date.", "Remember PASS: Pull the pin, Aim at the base, Squeeze the handle, Sweep side to side."],
  },
  "clean refrigerator coils": {
    q: "clean refrigerator coils",
    need: ["Vacuum with a brush attachment", "A coil brush"],
    steps: ["Unplug the fridge.", "Find the coils at the back or behind the bottom front grille.", "Brush and vacuum off the dust.", "Plug it back in and check it starts."],
  },
  "run garbage disposal and clean drains": {
    q: "clean garbage disposal",
    need: ["A handful of ice cubes"],
    steps: ["Turn on cold water and the disposal, and feed in the ice cubes to scrub the blades.", "Flush with hot water for a minute.", "Skip bleach and harsh drain cleaners."],
    tip: "Never put your hand in the disposal, even when it's off.",
  },
  "clean dishwasher filter": {
    q: "clean dishwasher filter",
    need: ["Soft brush, warm soapy water"],
    steps: ["Pull out the bottom rack, then twist or lift out the filter.", "Rinse it under warm water and scrub off any grime.", "Put it back and lock it in place, then run a cleaning cycle with the cleaner your manual recommends."],
  },
  "test garage door auto-reverse": {
    q: "test garage door auto reverse",
    need: ["A 2x4 board or a roll of paper towels"],
    steps: ["Lay the board flat on the floor in the door's path.", "Close the door with the remote: it should reverse when it touches the board.", "Wave a broom handle in front of the photo-eye sensors while it's closing: it should reverse.", "If it fails either test, adjust per your opener's manual or call a technician."],
    tip: "A door that doesn't reverse can injure a child or pet. Don't skip this one.",
  },
  "replace smoke detector batteries": {
    q: "replace smoke detector battery", links: ["smoke"],
    need: ["Fresh batteries of the right type", "A step stool"],
    steps: ["Remove the alarm from its base and swap the battery.", "Press the test button to confirm it sounds.", "Units with a sealed 10-year battery can't be changed: replace the whole alarm at its date."],
  },
  "furnace service": {
    q: "furnace tune-up what to expect",
    need: ["A licensed heating technician"],
    steps: ["Book before the cold arrives, since technicians get busy.", "Ask them to check the heat exchanger, burners, igniter, thermostat and carbon monoxide levels.", "Change the filter on the same day."],
    links: ["co"],
  },
  "ac service": {
    q: "air conditioner tune-up what to expect",
    need: ["A licensed HVAC technician"],
    steps: ["Book in spring, before the first heat wave.", "Ask them to check refrigerant, coils, drain line and electrical connections.", "Clear leaves and debris from around the outdoor unit yourself."],
  },
  "clean gutters": {
    q: "clean gutters safely",
    need: ["A sturdy ladder", "Gloves and a gutter scoop", "A bucket and a garden hose"],
    steps: ["Set the ladder on firm, level ground and keep three points of contact.", "Scoop out debris into the bucket, working toward the downspout.", "Flush with the hose and check the water flows out of the downspouts and away from the house.", "Look for sagging sections or leaks at joints."],
    tip: "If the roof is high or steep, hiring it out is cheaper than a fall.",
  },
  "disconnect hoses and shut off hose bibs": {
    q: "winterize outdoor faucets",
    need: ["Faucet covers (optional)"],
    steps: ["Unscrew every hose and drain it.", "If there is an inside shutoff for the outdoor faucet, close it, then open the outdoor faucet to drain what's left.", "Cover the faucet with an insulated cap."],
  },
  "chimney and fireplace inspection": {
    q: "chimney inspection what to expect",
    need: ["A certified chimney sweep"],
    steps: ["Book before burning season.", "Ask for a full inspection of the flue and cap as well as the sweep."],
    links: ["co"],
  },
  "check caulk and weatherstripping": {
    q: "recaulk windows and replace weatherstripping",
    need: ["Exterior caulk, a caulk gun, a utility knife", "Weatherstripping for the gaps you find"],
    steps: ["Look and feel for drafts around windows and doors.", "Cut out cracked old caulk, then clean and dry the gap.", "Apply a steady bead and smooth it with a damp finger.", "Replace worn weatherstripping on doors."],
  },
  "test main water shutoff valve": {
    q: "test main water shut off valve",
    need: ["Know where the valve is (often near where the line enters the house)"],
    steps: ["Turn the valve fully off, then fully on, to keep it from seizing.", "Look for drips around the valve afterward.", "If it's stiff or leaks, have a plumber replace it before you need it."],
    tip: "Make sure everyone in the house knows where it is.",
  },
  "inspect appliance hoses and under-sink plumbing": {
    q: "inspect washing machine hoses and under sink plumbing",
    need: ["A flashlight and a dry paper towel"],
    steps: ["Look under sinks and behind the washer and dishwasher for drips, rust, bulges or crusty deposits.", "Wipe the connections with a dry paper towel: any dampness means a leak.", "Replace rubber washer hoses with braided steel ones about every 5 years."],
  },

  // ---------------- yard ----------------
  "mow lawn": {
    q: "mow lawn properly",
    need: ["A mower with a sharp blade"],
    steps: ["Mow when the grass is dry.", "Never cut off more than a third of the blade height at once.", "Change direction each time so the grass doesn't lean."],
  },
  "winterize sprinklers": {
    q: "winterize sprinkler system blowout",
    need: ["An air compressor and fittings, or a sprinkler company"],
    steps: ["Turn off the water supply to the system.", "Blow the lines out zone by zone, wearing eye protection.", "Stay under the pressure your system's maker allows, since too much damages pipes and heads."],
    tip: "Many people hire this out: it's quick for a pro and a mistake can be costly.",
  },
  "start up sprinklers": {
    q: "start up sprinkler system in spring",
    need: ["Your timer's manual"],
    steps: ["Turn the water back on slowly.", "Run each zone and look for broken heads, leaks and spray hitting the house or sidewalk.", "Set the timer for the season."],
  },
  "fertilize lawn": {
    q: "when and how to fertilize lawn",
    need: ["Fertilizer for your grass type", "A spreader"],
    steps: ["Pick a fertilizer that matches your grass and the season.", "Set the spreader to the rate on the bag and apply evenly.", "Water it in unless the label says not to."],
    tip: "A cheap soil test tells you what your lawn actually needs.",
  },
  "service lawn mower": {
    q: "lawn mower tune up",
    need: ["Mower oil, a spark plug, an air filter", "Blade sharpener or a shop"],
    steps: ["Disconnect the spark plug wire first.", "Tip the mower with the air filter and carburetor side up, and remove and sharpen the blade.", "Change the oil, spark plug and air filter.", "Use fresh fuel, and a fuel stabilizer if it sits."],
  },

  "inspect roof and attic": {
    q: "inspect roof and attic for problems",
    need: ["Binoculars", "A flashlight"],
    steps: ["From the ground, look for missing, curled or cracked shingles and damaged flashing.", "In the attic, look for water stains, damp insulation, daylight through the roof and signs of pests.", "Call a roofer rather than walking on the roof yourself."],
  },
  "aerate lawn": {
    q: "how to aerate a lawn",
    need: ["A core aerator (rent one)"],
    steps: ["Water the lawn a day or two before, so the soil is moist.", "Make passes with the aerator in two directions.", "Leave the soil plugs on the lawn to break down, then overseed if it's thin."],
  },
  "weed beds and refresh mulch": {
    q: "weed garden beds and add mulch",
    need: ["Gloves, a hoe or hand weeder", "Mulch"],
    steps: ["Pull weeds, roots and all, after the soil is damp.", "Spread mulch 2 to 3 inches deep.", "Keep it a few inches back from tree trunks and the house foundation."],
  },
  "trim trees and shrubs": {
    q: "how to prune trees and shrubs safely",
    need: ["Pruning shears and a pruning saw", "A professional for anything near power lines or high up"],
    steps: ["Cut dead, broken or crossing branches first.", "Keep branches clear of the roof and wires.", "Make clean cuts just outside the branch collar."],
  },
  "test pool water chemistry": {
    q: "test and balance pool water",
    need: ["A test kit or strips"],
    steps: ["Test chlorine, pH and alkalinity.", "Adjust one chemical at a time and let the pump circulate before retesting.", "Keep a log of your readings."],
  },
  "clean pool filter": {
    q: "clean pool filter",
    need: ["Your filter's manual"],
    steps: ["Turn the pump off.", "Backwash a sand or DE filter, or take out and rinse a cartridge filter.", "Restart the pump and check the pressure gauge."],
  },

  // ---------------- emergency ----------------
  "rotate emergency water": {
    q: "store emergency water", links: ["water", "kit"],
    need: ["Food-grade containers"],
    steps: ["Aim for about 1 gallon per person per day, and ideally two weeks' worth.", "Replace stored water by the date on the container or yearly, and label new containers with the date.", "Store in a cool, dark place."],
  },
  "check food storage": {
    q: "emergency food storage rotation", links: ["kit"],
    need: ["A marker"],
    steps: ["Check expiration dates and move the oldest to the front.", "Eat what is about to expire and replace it.", "Keep a manual can opener with the food."],
  },
  "check flashlights and batteries": {
    q: "emergency flashlight and battery check", links: ["kit"],
    need: ["Fresh batteries"],
    steps: ["Turn on each flashlight and radio.", "Replace weak batteries and keep spares.", "Store batteries outside the devices if they leak often."],
  },
  "restock first aid kit": {
    q: "first aid kit checklist", links: ["kit"],
    need: ["The items you've used", "Any that expired"],
    steps: ["Check expiration dates on medications and ointments.", "Replace what's used up or past date.", "Check the kit also has bandages, gloves and any prescriptions your family needs."],
  },
  "review family emergency plan": {
    q: "family emergency plan template", links: ["kit"],
    need: ["Everyone in the household for 15 minutes"],
    steps: ["Agree on a meeting spot near home and another farther away.", "Make sure everyone knows an out-of-area contact's number.", "Go over your evacuation routes.", "Update the Emergency tab in this app."],
  },
  "check go-bags": {
    q: "go bag checklist", links: ["kit"],
    need: ["Each person's bag"],
    steps: ["Swap clothing for the current season and sizes.", "Check food, water, batteries and medications for dates.", "Keep copies of key documents and some cash in small bills."],
  },
  "test generator or backup power": {
    q: "how to test a portable generator safely", links: ["co"],
    need: ["Fresh fuel and a work area outdoors"],
    steps: ["Run it outdoors only, well away from windows, doors and vents.", "Run it under load for 10 to 15 minutes.", "Use fresh fuel or stabilizer, and store fuel safely."],
    tip: "Carbon monoxide from a generator can kill. Never run one in a garage or indoors, even with the door open.",
  },
  "practice fire escape drill": {
    q: "home fire escape plan drill", links: ["fire"],
    need: ["Everyone at home"],
    steps: ["Plan two ways out of every room.", "Pick a meeting spot outside, like the mailbox.", "Practice once at night so children know what the alarm sounds like.", "Get out first, then call 911 from outside."],
  },
  "check fire extinguisher readiness": {
    q: "check fire extinguisher", links: ["extinguisher"],
    need: ["None"],
    steps: ["Check the gauge is in the green and the pin is in place.", "Make sure one is in the kitchen and one in the garage, where you can reach it.", "Replace it if it's past the date on the label."],
  },
  "refresh vehicle emergency kit": {
    q: "car emergency kit checklist", links: ["car"],
    need: ["Replacements for anything used or expired"],
    steps: ["Check the blanket, water, snacks, flashlight and first aid items.", "Test the jumper cables and flares or reflectors.", "Swap in season-specific items like an ice scraper or extra water."],
  },
};

const norm = (t) => String(t || "").split(" — ")[0].replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase();

/** The how-to entry for a task, or null. Matching uses the task's title only, so customised copies of standard tasks still match. */
export function howtoFor(task) {
  const e = task && HOWTO[norm(task.title)];
  if (!e) return null;
  return { ...e, links: (e.links || []).map((k) => SOURCES[k]).filter(Boolean) };
}
export { norm as normTitle };
