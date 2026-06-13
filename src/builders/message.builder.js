export class MessageBuilder {

    static build({

        systemPrompt,

        character,

        memory = [],

        summary = null,

        messages = [],

        userMessage

    }){

        const finalMessages = [];

        //
        // SYSTEM
        //

        finalMessages.push({

            role: "system",

            content: systemPrompt

        });


        //
        // CHARACTER
        //

        let characterPrompt = `

            Name: ${character.display_name}

            Description:

            ${character.description}

            Personality:

            ${character.personality}

            Scenario:

            ${character.scenario}

        `;

        if(character.example_dialogues?.length){

            characterPrompt += "\nExample Dialogues:\n";

            for(const example of character.example_dialogues){

                characterPrompt += `

                    User:

                    ${example.user}

                    ${character.name}:

                    ${example.char}

                `;

            }

        }

        finalMessages.push({

            role: "system",

            content: characterPrompt.trim()

        });


        //
        // MEMORY
        //

        if(memory.length){

            finalMessages.push({

                role: "system",

                content:

                `Known facts:

                ${memory.join("\n")}`

            });

        }


        //
        // SUMMARY
        //

        if(summary){

            finalMessages.push({

                role: "system",

                content:

                `Conversation Summary:

                ${summary}`

            });

        }


        //
        // CHAT HISTORY
        //

        for(const msg of messages){

            finalMessages.push({

                role: msg.role,

                content: msg.content

            });

        }


        //
        // CURRENT MESSAGE
        //

        finalMessages.push({

            role: "user",

            content: userMessage

        });


        return finalMessages;

    }

}