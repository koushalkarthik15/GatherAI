import { config } from 'zod';

// Configure before application modules validate persisted data.
config({ jitless: true });
