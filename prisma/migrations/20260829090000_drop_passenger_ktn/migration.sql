-- Known Traveler Number is never applicable for this operator's charter
-- clients — drop the field rather than keep collecting it unused.
ALTER TABLE "Passenger" DROP COLUMN "ktn";
